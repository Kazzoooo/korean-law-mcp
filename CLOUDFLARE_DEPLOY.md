# Cloudflare Workers Deploy

이 문서는 `korean-law-mcp`를 Cloudflare Workers에 배포하는 최소 절차다.

## 추가된 내용

- `src/worker.ts`
  - Express 대신 Workers `fetch` 엔트리 사용
  - MCP stateless HTTP 유지
  - `/health`, `/mcp` 제공
- `wrangler.jsonc`
  - `nodejs_compat` 사용
  - Worker 엔트리 지정

## 1. 필수 준비물

- Cloudflare 계정
- `LAW_OC` 법제처 API 키
- Node 20+

## 2. 로컬 Worker 개발

```powershell
npx wrangler dev
```

확인 경로:

- `GET /health`
- `POST /mcp`

## 3. 시크릿 설정

`LAW_OC`는 Worker secret으로 넣는다.

```powershell
npx wrangler secret put LAW_OC
```

필요하면 아래도 환경설정으로 관리:

- `KOREAN_LAW_API_KEY`
- `CORS_ORIGIN`
- `RATE_LIMIT_RPM`

## 4. 배포

```powershell
npx wrangler deploy
```

배포 후 엔드포인트 예시:

```text
https://<your-worker-subdomain>.workers.dev/mcp
```

## 5. 통합 MCP 연결

현재 통합 MCP에서는 아래처럼 바꾸면 된다.

```env
LAW_MCP_URL=https://<your-worker-subdomain>.workers.dev/mcp
```

## 6. 주의사항

- 기존 Node `src/index.ts` / Express 서버도 그대로 유지된다.
- Cloudflare 배포는 `src/worker.ts` 경로만 사용한다.
- 대용량 문서 처리와 PDF 파싱은 실제 트래픽 기준으로 한 번 더 검증하는 것이 좋다.
