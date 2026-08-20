# 윷놀이 웹 게임 — 기술 스택 / 아키텍처 (v0.1)

## 1. 결정 사항

| 영역 | 선택 | 이유 |
|---|---|---|
| 프론트엔드 | React + TypeScript + Vite | songpyeon과 동일 스택 재사용 — 검증된 조합, 별도 학습곡선 없이 바로 시작 |
| 실시간 서버 | Node.js + TypeScript + **Colyseus** | 방(room) 단위 서버 권위형 상태 동기화가 이 게임(4인, 말 위치, 턴 순서, 게이지 판정)의 요구사항과 정확히 일치. songpyeon에서 이미 검증됨 |
| 던지기 연출 | **Matter.js** (2D 물리엔진, 클라이언트 전용) | 윷가락 4개가 굴러떨어지는 연출을 새로 시도해보는 학습 지점. 결과값 자체는 서버가 이미 확정(§3)하므로 물리 시뮬레이션은 순수 연출용이며 판정에 관여하지 않음 |
| 배포 | 미정 | REQUIREMENTS.md §11 참고 — songpyeon(AWS EC2+Docker+Caddy)이나 omok(kind→EKS) 선례 중 추후 결정 |

## 2. 왜 서버 권위형(authoritative)인가

- 이 게임의 핵심 상태는 전부 "정확히 하나의 값"이어야 한다 — 말 위치, 현재 턴, 윷 던지기 결과가 클라이언트마다 다르게 계산되면 4명의 화면이 어긋나는 동기화 버그로 직결된다.
- 따라서 서버가 다음을 전부 소유한다: 턴 순서(REQUIREMENTS.md §4), 게이지 판정(§5), 말 위치·업기·잡기 처리(§6), 승리 판정(§7).
- 클라이언트는 입력(누르기/떼기 시각, 이동할 말 선택)을 서버로 보내고, 서버가 검증한 결과(상태 diff)만 받아 그린다 — "그리기 전용" 클라이언트.

## 3. 윷 던지기 게이지 — 서버 시간 기반 판정

- 클라이언트가 화면을 누르는 순간 서버에 `throwStart` 메시지를 보낸다. 서버는 그 시각(서버 자체 시계 기준)을 기록하고, 이후 게이지 파형 함수 `gauge(t) = f(elapsed)`(왕복 파형, 구간별 폭은 REQUIREMENTS.md §5의 확률 표를 반영)를 서버가 소유한다.
- 클라이언트가 손을 떼는 순간 `throwRelease` 메시지를 보낸다. 서버는 `release 시각 - start 시각`을 자신의 시계로 계산해 `gauge()` 함수에 대입, 어느 구간(도/개/걸/윷/모)에 해당하는지 결정한다. 도 구간에 해당하면 **하위 구간 판정을 한 번 더** 수행해 도(75%)/빽도(25%)를 가른다(REQUIREMENTS.md §5) — 클라이언트가 별도 요청을 보낼 필요 없이 동일한 `throwRelease` 한 번으로 서버가 두 단계 판정을 이어서 처리한다.
- **클라이언트가 로컬에서 계산한 게이지 값이나 결과는 신뢰하지 않는다** — 클라이언트 쪽 게이지 UI는 서버와 같은 파형 함수를 사용해 시각적으로 미리 보여주는 것뿐이고, 최종 판정은 항상 서버의 재계산 값을 따른다. (songpyeon의 클라이언트-서버 시계 오차 이슈와 동일한 이유로, ping/pong RTT 기반 `clockOffsetMs` 보정을 클라이언트 표시에는 적용하되 판정 자체는 서버 시계만 사용)
- 이 구조는 songpyeon에는 없던 "타이밍이 결과에 영향을 주는 스킬형 판정"을 서버 권위형 원칙을 깨지 않고 구현하는 지점이라, 별도 섹션으로 분리해 기록.

## 4. Colyseus 개념 매핑

| Colyseus 개념 | 이 게임에서의 의미 |
|---|---|
| Room | 한 경기(2팀×2인 고정) |
| State (Schema) | 4명의 캐릭터 선택, 말 8개(4인×2개)의 위치, 현재 턴 플레이어, 게이지 진행 상태(phase: idle/charging/resolved), 승리 팀 |
| Message (client→server) | `throwStart`, `throwRelease`, `movePiece: { pieceId, destination }`, `sendChat` |
| Message (server→client, 자동) | State 변경분 자동 브로드캐스트 (말 이동, 턴 전환, 던지기 결과, 승리 확정) |
| onJoin / onLeave | 참가자 입장/퇴장, 대기실 캐릭터·팀 선택 처리 |

## 5. 저장소 구조 (모노레포)

```
yutnori/
  docs/
    REQUIREMENTS.md
    ARCHITECTURE.md
  package.json          # workspaces root, concurrently로 dev 동시 실행
  kill-ports.js          # dev 실행 전 포트 점유 프로세스 정리 (songpyeon/omok와 동일 패턴)
  client/                # React + TS + Vite + Matter.js
  server/                # Node + TS + Colyseus
```

- 프론트/백엔드를 하나의 저장소에서 npm workspaces로 관리, songpyeon/omok과 동일한 관례.
- 문서는 `docs/`에 모음.
- 루트에서 `npm run dev` 한 번으로 server+client가 동시에 뜨는 구조를 songpyeon과 동일하게 재사용.

## 6. 다음 단계

문서 작성 완료: REQUIREMENTS.md, ARCHITECTURE.md. 다음은 모노레포 스캐폴딩 → 코어 게임 로직(순수 함수 + TDD, songpyeon `server/src/game/` 패턴 재사용) → Colyseus room 연결 → 클라이언트 화면 순으로 진행 예정. 실제 구현은 REQUIREMENTS.md §11의 열린 질문(캐릭터 배정 방식, 대기실 팀 선택 UX 등)을 먼저 좁힌 뒤 구현 계획(writing-plans)으로 넘어간다.
