# 윷놀이 웹 게임

"마피아42"의 인게임 미니게임 **윷놀이**를 [Colyseus](https://colyseus.io/) 기반 실시간 멀티플레이어 웹 게임으로 이식한 프로젝트입니다.

## 게임 소개

- 2v2(팀당 2인, 인당 말 2개) 또는 1v1(인당 말 4개) 모드로 진행되는 실시간 대전 보드게임입니다.
- 실제 정사각형 윷판(외곽 20칸 + 5/10/15번 대각선 지름길 + 중앙)을 SVG로 시각화하고, 게이지를 꾹 눌렀다 떼는 방식으로 윷을 던집니다 — 실제 윷가락 4개(앞/뒤) 조합 확률을 그대로 반영한 물리 연출(Matter.js)도 함께 보여줍니다.
- 캐릭터별 특수 능력(교주/성직/마담/의사)이 있어 잡기·업기·전진에 확률적으로 개입합니다.
- 정확한 규칙은 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) 참고.

### 그 밖의 기능

- 구글 로그인 기반 계정, 계정당 고정 닉네임(최초 1회 설정, 이후 관리자만 변경 가능)
- 대기실/팀·캐릭터 선택, 진행 중인 매치 관전 입장, 갑작스런 연결 끊김 시 20초 재접속 유예
- 화면 우하단 채팅창(대기실/플레이 어디서든), 턴/능력 발동 알림
- 관리자 페이지(`/admin`): 활성 방/접속자 현황, 입장·퇴장 로그, 채팅 로그, 계정별 IP 이력, 일일 방문자 수, 유저 밴/닉네임 강제 변경(+ 닉네임 검색), 공지 배너 발송, 문의함

## 기술 스택

| 영역 | 스택 |
|---|---|
| 프론트엔드 | React 19 + TypeScript + Vite, Matter.js(윷가락 물리 연출) |
| 실시간 서버 | Node.js + TypeScript + Colyseus (서버 권위형 상태 동기화) |
| 데이터베이스 | SQLite (better-sqlite3) |
| 인증 | Google OAuth (ID 토큰 검증), JWT 세션 쿠키 |
| 배포 | AWS EC2 + Docker + Caddy(자동 HTTPS 리버스 프록시) |

기술 선택 이유는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.

## 프로젝트 구조

npm workspaces 모노레포입니다.

```
yutnori/
├── client/                 # React + Vite 프론트엔드
│   └── src/
│       ├── components/     # 화면 단위 컴포넌트 (WaitingRoom, GameBoard, TurnPanel, Admin* 등)
│       └── game/           # 클라이언트 게임 로직/훅 (보드 좌표, 클록 동기화 등)
├── server/                 # Node + Colyseus 백엔드
│   └── src/
│       ├── game/           # 순수 함수로 분리된 핵심 게임 규칙 (각각 테스트 동반)
│       ├── rooms/          # Colyseus Room (MatchRoom) / State (MatchState)
│       ├── auth/           # 구글 로그인, 세션, 닉네임
│       ├── admin/          # 관리자 페이지 API (로그, 밴, 공지, 문의)
│       └── db/             # SQLite 연결 및 스키마
├── docs/                   # 요구사항 명세, 아키텍처, 트러블슈팅, 설계 문서
└── package.json            # workspaces root
```

## 로컬 실행

루트 디렉토리에서:

```bash
npm install
npm run dev          # server(2567)+client(5173) 동시 실행
```

| 명령어 | 설명 |
|---|---|
| `npm run dev` | server + client 동시 실행 (predev가 두 포트를 먼저 정리) |
| `npm run dev:server` | server만 실행 |
| `npm run dev:client` | client만 실행 |

서버 환경변수(`GOOGLE_CLIENT_ID`, `SESSION_JWT_SECRET`, `ADMIN_PASSWORD`)는 `server/.env`에서 읽습니다(`server/.env.example` 참고, git 미포함이라 직접 생성 필요). 클라이언트 쪽 `VITE_GOOGLE_CLIENT_ID`는 `client/.env.local`에서 읽습니다.

관리자 페이지(`/admin`)와 구글 로그인은 same-origin에서만 동작하므로, 로컬에서 확인하려면 client를 빌드해 `server/public`에 복사한 뒤 서버가 직접 서빙하는 2567 포트로 접속해야 합니다:

```bash
npm run build --workspace client
# client/dist 내용을 server/public으로 복사 후 npm run dev:server
```

### 개별 워크스페이스 명령어

**server/**
```bash
npm run dev    # tsx watch src/index.ts
npm test       # vitest run
npm run build  # tsc --noEmit (타입체크만)
```

**client/**
```bash
npm run dev    # vite
npm run build  # tsc -b && vite build
npm run lint   # oxlint
```

client에는 자동화 테스트 프레임워크가 없습니다 — `npm run build`(타입체크) + 실제 브라우저 확인으로 검증합니다.

## 배포

AWS EC2 단일 인스턴스에 Docker 컨테이너로 배포합니다(CI/CD 없이 수동: `docker build` → `docker save` → `scp` → EC2에서 `docker load` 후 컨테이너 교체). 앞단에 Caddy가 자동 HTTPS 리버스 프록시로 붙어 있습니다. 절차와 유의사항은 [CLAUDE.md](CLAUDE.md)의 "배포" 절 참고.

## 문서

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — 게임 규칙 명세
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 기술 스택 선택 이유
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — 실제 발생한 버그와 근본 원인 기록
- [CLAUDE.md](CLAUDE.md) — 아키텍처/기능별 상세 노트, 배포 절차, 개발 시 유의사항(Gotchas)
