# Changelog

## [3.4.0] - 2026-04-16

### Added
- `lib/decision-compact.ts` — 판례/헌재/행심 응답 토큰 최적화 유틸 신규:
  - `compactBody(text, opts)` — 본문 계단식 축약 (앞 800자 + 중략 + 뒤 400자, 문장 경계 가드)
  - `densifyLawRefs(text)` — 참조조문 괄호 설명 제거 + 구분자 정리
  - `densifyPrecedentRefs(text)` — 참조판례 "선고/판결" 제거 + 날짜 공백 압축
  - `stripRepeatedSummary(body, summaries)` — 본문 앞쪽에 반복 기재된 판시/요지 제거
- `get_decision_text`에 `full?: boolean` 파라미터 추가 — `true`=전문 그대로, 미지정(기본)=축약
- 개별 핸들러(`get_precedent_text`, `get_constitutional_decision_text`, `get_admin_appeal_text`)에도 동일 파라미터 전파

### Changed
- **판례 응답 토큰 평균 -74%** (실측: `b4875a3` vs `69f6918`, 3개 도메인 × 8건 고정 ID):
  - 판례: 5,230 → 3,049 chars (-42%)
  - 헌재: 8,368 → 1,703 chars (-80%)
  - 행심: 8,429 → 1,491 chars (-82%)
  - 긴 결정례(15,000자 이상)에서 80~89% 절감 — 판시/요지/주문은 full 유지, 본문만 축약
- **ListTools 페이로드 -14%** (9,671 → 8,296 bytes, 344 토큰↓):
  - `chain_*` 8개 description 간결화 (`[⛓체인]` → `[⛓]`, 예시 구문/메타 문구 제거)
  - `search_decisions`/`get_decision_text` 필드 describe 다이어트 (17 도메인 이중 기재 제거)
  - `discover_tools`/`execute_tool` description 축약

### Why
- 3개 MCP 동시 운용 환경에서 판례 호출 1회가 12.5k 토큰 상한(50KB)을 먹어 컨텍스트 블랙홀화
- 법령 RAG 관점에서 판시사항·판결요지·주문은 규범 재사용 핵심이라 full 유지, "이유" 전문은 사안별 사실관계 나열이라 축약해도 손실 미미
- 중략된 구간은 `full=true`로 재호출 가능 — backward compatible

### How to apply
- 적용 도메인: `precedent`, `constitutional`, `admin_appeal` (판례/헌재/행심)
- 해석례·기타 짧은 도메인은 미적용 (원래 짧음)
- 사용자는 자연어로 "전문 그대로", "full로 다시"라고 요청하거나 LLM이 description 보고 자동 판단
- 응답 중간의 `⋯ 중략 N자 (full=true로 전문 조회) ⋯` 마커가 힌트

## [3.2.2] - 2026-04-12

### Added
- `get_annexes`를 V3_EXPOSED에 추가 (14개 → 15개 노출). `discover_tools` → `execute_tool` 왕복 없이 별표/서식 직접 조회 가능
- `chains.ts` `detectExpansions`: 환불·반환·배상·수강료·이용료·회비·N만원 키워드 추가 — 소비자분쟁 질의에서 `chain_full_research`가 별표 자동 포함

### Why
- 트레이스 `ld-1775959823220` (헬스장 1년권 환불, 79s) 분석 결과: 별표 3의2 조회를 위해 `discover_tools` × 2 + `execute_tool(get_annexes(...))` 헛발질로 ~15초 손실
- 노출 기준: 체인 도구가 fallback으로 자주 호출하는 종착 도구 + discover→execute 왕복으로 5초+ 손실
- `tool-registry.ts` 상단 주석에 제거 금지 경고 명시

## [3.0.2] - 2026-04-08

### Added
- `npx korean-law-mcp setup` — 대화형 설치 마법사 (API 키 입력 → 8개 클라이언트 자동 설정)
- 지원 클라이언트: Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Gemini CLI, Zed, Antigravity
- STDIO 모드에서 `MCP_PROFILE` 환경변수 지원

### Fixed
- API 커버리지 수치 39개 → 41개로 정정 (실제 사용 target 기준 재집계)

## [3.0.1] - 2026-04-08

### Added
- get_ordinance: `jo` 파라미터 추가 — 특정 조문 본문 직접 조회 가능 (#19)
- 대형 조례(20개 초과) 목차 반환 시 `jo` 사용법 안내 메시지 추가

### Fixed
- get_ordinance: 조문 필터링을 조제목 텍스트 매칭에서 조문번호(JO 코드) 기반으로 변경 — API 응답의 조제목에 조번호가 없는 구조 대응
- get_ordinance: "제20조" 검색 시 "제20조의2" 등 의X 조문이 잘못 매칭되는 문제 수정

## [2.2.0] - 2026-04-01

### Added
- 23개 신규 도구: 조약(2), 법령-자치법규 연계(4), 학칙/공단/공공기관(6), 특별행정심판(4), 감사원(2), 약칭(1), 행정규칙 신구대조(1), 조항호목(1), 문서분석(1), chain_document_review(1)
- date-parser: 자연어 시간 표현 → YYYYMMDD 변환 (10개 패턴)
- document-analysis: 8종 문서유형 분류, 17개 리스크규칙, 금액/기간 추출, 조항 충돌 탐지
- 판례/해석례 날짜 필터 (fromDate/toDate)

### Changed
- 에러 처리 통일: 40개 도구의 인라인 에러 → formatToolError 전환
- 중복 XML 파서 6개 → 공용 parseSearchXML 통합
- cli.ts 분리: cli-format.ts + cli-executor.ts + cli.ts (689줄 → 443+181+227)
- annex.ts: AnnexItem 타입 정의, any 12회 제거

### Security
- sse-server.ts: CORS * → CORS_ORIGIN 환경변수 기반
- sse-server.ts: API 키 쿼리스트링 경로 제거 (헤더만 허용)
- sse-server.ts: 보안 헤더 추가 (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- sse-server.ts: 세션 ID 로그 마스킹 (첫 8자만 출력)

### Fixed
- 조약 XML 아이템태그 대소문자 (trty→Trty), 본문 JSON 키 (BothTrtyService)
- 연계 fetchApi type 기본값 제거 (type=XML 시 500 발생)
- api-client.ts: type 파라미터 미지정 시 생략

- 총 도구 수: 64 → 87

## [1.9.0] - 2026-03-15

### Fixed
- HWP 구형 파서: `controls` 내 테이블(표) 추출 지원
  - `hwp.js`의 `paragraph.controls[].content` 경로에서 테이블 구조(rows/cells) 탐색
  - 기존에는 `paragraph.content`만 탐색하여 표 형식 HWP 파싱 실패

## [1.8.1] - 2026-03-15

### Changed
- MCP 도구 스키마 최적화: description 압축 + apiKey 은닉

## [1.8.0] - 2026-03-10

### Added
- 체인 도구 7개: chain_law_system, chain_action_basis, chain_dispute_prep, chain_amendment_track, chain_ordinance_compare, chain_full_research, chain_procedure_detail
- get_batch_articles: `laws` 배열 파라미터로 복수 법령 일괄 조회 지원
- search_ai_law: `lawTypes` 필터로 법령종류별 결과 필터링
- truncateSections(): 체인 도구 섹션별 응답 크기 최적화
- truncateResponse summary 모드: 긴 응답 자동 요약
- unwrapZodEffects: .refine() 스키마의 MCP 호환성 개선
- 구조화된 에러 포맷: [에러코드] + 도구명 + 제안

### Changed
- formatToolError: ZodError 자동 감지, 구조화된 출력
- toMcpInputSchema: ZodEffects unwrap 후 JSON Schema 변환
- 총 도구 수: 57 → 64
