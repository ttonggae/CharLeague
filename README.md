# 그림전쟁 — 로컬 연습과 온라인 대전

TypeScript, Vite, HTML Canvas 기반 1대1 격투게임입니다. 연습 모드에서는 더미와 싸우고, 온라인 대전에서는 Trystero WebRTC로 다른 브라우저와 P2P로 연결합니다.

## 실행과 확인

개발·빌드에는 Node.js 20.19+ 또는 22.12+가 필요합니다. 제공된 테스트 명령은 TypeScript strip 지원이 있는 Node.js 24에서 검증했습니다.

```bash
pnpm install
pnpm dev
```

터미널에 나온 주소(기본 `http://localhost:5173`)를 엽니다. `pnpm build`는 타입 검사와 배포 빌드, `pnpm test`는 전투·캐릭터 로딩 검증을 실행합니다. npm을 쓴다면 `npm install`, `npm run dev`, `npm run build`, `npm run test`를 사용합니다.

## 온라인 대전

1. 첫 번째 플레이어가 메인 메뉴에서 **온라인 대전**을 누르고 초대 링크를 복사합니다. 이 브라우저가 P1입니다.
2. 두 번째 플레이어가 링크를 열면 P2로 자동 참가합니다. 같은 주소에 접근할 수 있어야 하므로 다른 컴퓨터와 플레이할 때는 게임을 양쪽에서 접근 가능한 HTTPS 주소로 제공하세요. 로컬 `127.0.0.1` 링크는 다른 컴퓨터에서 열 수 없습니다.
3. 양쪽이 캐릭터를 고르고 **준비**를 누르면 캐릭터 데이터 버전을 확인하고 3초 뒤 시작합니다. 이미지 파일은 전송하지 않으므로 양쪽에 동일한 게임 파일이 있어야 합니다.
4. 상대가 떠나거나 연결에 실패하면 **다시 연결** 또는 **메인 메뉴**를 선택할 수 있습니다. 재연결 후에는 다시 준비해 새 대전을 시작합니다.

온라인 대전은 3판 2선승입니다. 각 KO 화면을 게임 로직 기준 180틱(3초) 동안 표시한 뒤 다음 판에서는 체력과 위치를 초기화합니다. 2승을 거두면 마지막 KO 화면을 3초 표시하고 양쪽 모두 같은 연결을 유지한 채 캐릭터 선택 화면으로 돌아갑니다. 다시 캐릭터를 골라 준비하면 새 대전을 시작할 수 있습니다.

초대 토큰은 암호학적 난수로 생성한 192비트 값이며 URL fragment에 담깁니다. 방 코드 입력이나 별도 게임 서버는 없습니다. Trystero가 피어 탐색과 WebRTC 연결을 처리합니다. 현재는 두 플레이어만 입장할 수 있습니다. 온라인 전투는 60Hz 입력 프레임만 교환하고 기본 입력 지연은 3틱입니다. 상태 해시가 다를 때 P1의 스냅샷으로 복구합니다. 네트워크 지연이 크면 양쪽 진행이 잠시 멈출 수 있습니다.

선택 화면은 왼쪽 P1, 오른쪽 P2입니다. 각 플레이어는 자신의 칸에서 캐릭터를 누르면 준비 전에도 선택 내용이 상대에게 보입니다. 상대 칸은 읽기 전용입니다.

## 조작

| 입력 | 동작 |
| --- | --- |
| ← / → | 이동, 같은 방향을 14틱 이내 두 번 누르면 대시. 대시 재사용 대기시간 1초 |
| ↑ / ↓ | 점프 / 앉기 |
| Shift | 방어 |
| A | 한스의 베기 (`jab`): 선딜 12FPS 애니메이션 3프레임(60Hz 판정 15틱), 공격 동작 종료 후 재사용 대기시간 6틱(0.1초) |
| S / D | 현재 한스에게 등록된 기술 없음 |
| R | 연습 모드 전투 재시작 |
| C | 연습 모드에서 캐릭터 선택. 온라인 전투 중에는 동작하지 않음 |
| 1 / 2 / 3 | 연습 모드 더미 반격 / 방어 / 대기 |

### 통일된 조작 ID

`src/data.ts`의 `ACTION_IDS`가 기준입니다. 현재 한스에게 등록된 공격 ID는 `jab` 하나이고, `guard`와 `crouch`는 동작 애니메이션입니다. 아래 나머지 공격 ID는 새 캐릭터에서 등록할 수 있는 조작 규격이며, 등록하지 않은 기술은 사용할 수 없습니다. 기술에는 같은 ID를 `character.json`의 `moves[].id`와 `effect`, Atlas Studio의 `skills[].skillId`, `atlas.json`의 애니메이션 `skillId`에 사용합니다.

| ID | 입력 또는 동작 |
| --- | --- |
| `move_left` / `move_right` | ← / → 이동 |
| `jump` / `crouch` / `guard` | ↑ 점프 / ↓ 앉기 / Shift 방어 |
| `dash_left` / `dash_right` | ←← / →→ 대시 |
| `jab` / `step` | A 평타 / 전방 + A 전진타 |
| `sweep` / `rising` | ↓ + S 하단 베기 / ↑ + D 상승타 |
| `skill1` / `skill2` | S 스킬 1 / D 스킬 2 |
| `chain` | A → A → S 연계 |
| `counter` | 내장 연습 더미의 자동 반격 |
| `restart` / `select_character` | R 재시작 / C 캐릭터 선택 |
| `dummy_attack` / `dummy_guard` / `dummy_idle` | 1 반격 / 2 방어 / 3 대기 |

공격 입력은 15틱(0.25초) 동안 보관됩니다. 더미는 기본적으로 가까워지면 선택된 캐릭터의 `dummyMoveId` 기술로 반격합니다. 조작 가이드는 캐릭터 선택 화면에만 표시합니다. 전투를 시작하면 게임 캔버스가 브라우저 화면 전체를 채우며 브라우저 전체화면 전환을 강제하지 않습니다. F11 등으로 브라우저 전체화면을 켜거나 꺼도 전투가 계속됩니다. 연습 모드에서는 C로 캐릭터 선택 화면에 돌아갈 수 있습니다. 온라인 전투 중에는 나가기 조작이 없습니다. 연결이 끊긴 뒤에는 복구 화면에서 다시 연결하거나 메인 메뉴로 갈 수 있습니다.

게임 상태와 판정은 고정 60Hz로 갱신합니다. 캐릭터와 효과 아틀라스는 기본 5틱마다 프레임을 바꿔 12FPS로 표시합니다. 아틀라스는 이미지 보간 없이 정수 배율로 그려 작은 도트 이미지의 경계를 유지합니다. 캐릭터는 이동 방향을 바라보고 멈추면 마지막 방향을 유지합니다. 공격 판정과 효과도 바라보는 방향을 따릅니다. 전투 중 머리 위의 P1/P2 표시는 방향과 관계없이 읽을 수 있습니다. 캐릭터 아틀라스 로딩에 실패했을 때만 임시 색상 박스를 그립니다.

## 캐릭터 추가

`public/assets/characters/index.json`의 `characters` 배열에 ID를 넣고, 같은 ID의 폴더를 만듭니다. 게임 코드는 수정할 필요가 없습니다.

```text
public/assets/characters/
  index.json
  캐릭터ID/
    character.json
    atlas.json
    characters_1.png
    effects_1.png  (효과 아틀라스가 있을 때만)
    portrait.png
```

ID는 영문, 숫자, `_`, `-`만 사용합니다. 아틀라스 시트가 여러 장이면 `atlas.json`의 `atlases.characters`와 `atlases.effects` 배열에 등록하고 추가 PNG를 같은 캐릭터 폴더에 둡니다. 로더는 **프레임의 `atlas` 파일명**(없으면 `atlasIndex`)으로 해당 시트를 선택합니다. `index.json`에 등록한 순서가 선택 화면 순서입니다.

`character.json` 예시:

```json
{
  "id": "my-fighter",
  "name": "내 캐릭터",
  "description": "선택 화면에 표시할 짧은 설명",
  "color": "#82e8ff",
  "maxHp": 100,
  "walkSpeed": 4.1,
  "jumpSpeed": 13.4,
  "dashSpeed": 9,
  "width": 42,
  "height": 92,
  "atlas": "atlas.json",
  "portrait": "portrait.png",
  "dummyMoveId": "skill2",
  "moves": [
    {
      "id": "jab", "label": "평타", "sequence": ["A"], "direction": "any",
      "startup": 5, "active": 4, "recovery": 10,
      "damage": 7, "chip": 1, "knockback": { "x": 3, "y": 0 },
      "hitstun": 11, "reach": 59, "height": 48,
      "effect": "jab", "color": "#92efff",
      "bodyAnimation": "jab", "effectAnimation": "jab"
    }
  ]
}
```

기술 시간은 60Hz 틱, 속도와 거리는 게임 좌표 단위입니다. `direction`은 `any`, `forward`, `back`, `up`, `down` 중 하나입니다. 긴 입력 연계와 방향 조건 기술이 일반 기술보다 먼저 선택됩니다. `effect`는 기술 `id`와 같아야 하며 생략할 수 있습니다. `bodyAnimation`과 `effectAnimation`에는 통일된 기술 ID를 지정하고, 애니메이션을 공유한다면 공유할 기술 ID를 지정합니다. 생략하면 몸체는 `attack:<기술 id>`를, 효과는 기술 ID를 찾습니다. 몸체 애니메이션이 전체 캐릭터가 아니라 추가 파츠라면 `"bodyAnimationMode": "overlay"`를 지정해 idle 위에 겹쳐 그립니다. `spriteScale`을 설정하면 아틀라스 확대율을 직접 조정할 수 있습니다. 기본값은 `height / idle 원본 높이`를 올림한 정수 배율입니다. PNG의 원본 색상과 투명도를 그대로 사용하며 같은 캐릭터를 양쪽에 선택해도 변색하지 않습니다.

`atlas.json`은 Atlas Studio의 `schemaVersion: 2` 및 `schemaVersion: 3` 출력 형식을 지원합니다. `atlases.characters`, `atlases.effects`, `characterAnimations`, `effectAnimations`를 읽고 각 프레임의 `rect`, `trim`, `pivot`, `position`, `durationTicks`를 반영합니다. 캐릭터 시트와 효과 시트는 독립적으로 로드하고 재생합니다. `idle` 애니메이션은 선택 화면 미리보기에도 사용합니다. 현재 등록된 캐릭터는 `hans` 하나이며 양쪽 모두 선택할 수 있습니다.

한스의 `character.json`처럼 `schemaVersion: 1`, `characterId`, `displayName`, `skills`를 사용하는 Atlas Studio 내보내기도 지원합니다. `skills[].skillId`에 등록된 공격만 전투 기술로 만들고, `guard`와 `crouch`는 방어·앉기 애니메이션으로 사용합니다. 공격 항목에 `startupFrames`를 적으면 `ticksPerAnimationFrame`으로 곱해 60Hz 판정 틱으로 변환합니다. `startup`, `active`, `recovery`, `cooldown`은 60Hz 기준 정수 틱이며, `startup`과 `startupFrames`는 둘 중 하나만 사용합니다. `cooldown`은 공격 동작 종료 후부터 계산합니다. 한스의 `jab`은 A로 베기 공격을 하며, 내보낸 효과 프레임이 없으므로 별도 기술 효과는 그리지 않습니다. 이 형식에는 체력·이동·피해량 필드가 없으므로 현재 기본 전투 수치를 적용합니다. 이 수치를 캐릭터마다 지정하려면 위의 게임용 `character.json` 형식을 사용하세요. `portraitProvided: false`이거나 초상화 이미지 로딩에 실패하면 선택 화면에 큰 X를 표시합니다.

등록된 폴더나 파일이 누락되거나 JSON 형식이 잘못되면 해당 경로와 원인을 선택 화면 및 브라우저 콘솔에 표시합니다. 다른 정상 캐릭터는 계속 선택할 수 있고, 이미지가 누락된 캐릭터는 임시 그래픽으로 전투합니다. 모든 등록 캐릭터를 사용할 수 없으면 내장 임시 캐릭터 두 명을 표시합니다.

## 코드 구조

- `src/characters.ts`: `index.json` 목록, 캐릭터 데이터 검증, 누락 파일 복구
- `src/atlas.ts`: Atlas Studio v2/v3 다중 시트 로딩과 프레임 재생
- `src/data.ts`: 전투 데이터 타입과 임시 캐릭터, 전투 상수
- `src/input.ts`: 키 입력
- `src/game.ts`: 고정 60Hz 전투 로직과 더미 행동
- `src/render.ts`: Canvas 전투 렌더링
- `src/online.ts`: 입력 비트, 프레임 동기화, 해시·스냅샷 복구
- `src/network.ts`: Trystero 연결, 메시지 검증, 핑과 종료 처리
- `src/main.ts`: 메뉴, 캐릭터 선택, 온라인 로비와 게임 루프
