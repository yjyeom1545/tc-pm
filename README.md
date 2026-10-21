# TC 생산관리 · 외주 입고 등록 / 월마감 대사 (tc-pm)

담당자가 입고될 때마다 P/O 단위로 입고를 등록하고, 월말에 ERP 입고상세조회(.xls)를 올리면
등록 내역과 P/O 단위로 정합성을 검증합니다. 업체 거래명세서를 함께 올리면 ERP · 업체 · 입고등록 3자 대조.

- 화면: `index.html` (GitHub Pages로 배포)
- DB: Supabase 프로젝트 `tc-ai-office` (테이블 접두어 `pm_`)
- 대조 로직: `engine.js` (오프라인 도구 `대림_월마감_입고대사.html`과 동일)

## 메뉴
| 메뉴 | 내용 |
|---|---|
| 입고 등록 | 입고일 · P/O No · 품목/수량 입력. 단가는 입고일 기준 단가표에서 자동, 금액 자동 계산. P/O 형식·중복 즉시 확인 |
| 입고 내역 | 월별 조회, 담당자/품목 필터, 수정·삭제(본인 건), 엑셀 저장 |
| 월 마감 | ERP 입고상세조회 업로드 → P/O별 대조, 모델·품목군별 소계, 결과 엑셀, 마감 확정(해당 월 잠금) |
| 기준정보 | 품목, 단가표(적용일별 이력), ERP 모델 식별 마스터 |
| 사용자 | 계정 승인 · 권한(관리자만) |

## 권한
- 계정 신청 → 관리자 승인 후 사용. **첫 번째로 가입한 계정이 자동으로 관리자**가 됩니다.
- 담당자: 조회 · 입고 등록 · 본인 건 수정/삭제 · 마감 확정
- 관리자: 위 + 기준정보 수정, 타인 건 수정, 마감 잠금 해제, 사용자 승인
- 마감 확정된 월은 입고 수정·삭제가 DB 단에서 막힙니다.

## 처음 설정 (1회)
1. 이 폴더의 파일을 저장소 루트에 올리기 (GitHub → Add file → Upload files)
2. Settings → Pages → Source: Deploy from a branch → Branch: `main` / `/ (root)` → Save
3. Supabase 대시보드 → tc-ai-office → Authentication → URL Configuration
   - Site URL: `https://yjyeom1545.github.io/tc-pm/`
   - Redirect URLs에 같은 주소 추가 (가입 인증 메일 링크가 이 주소로 돌아옴)
4. 배포 주소 접속 → [계정 신청] → 메일 인증 → 로그인 (첫 계정 = 관리자)

## 9월 시범 데이터
ERP 9월분 기준으로 만든 입고 79건(담당 '9월 시범(이관)')이 들어 있어 월 마감 기능을 바로 시험할 수 있습니다.
실제 운영 전 삭제: Supabase SQL Editor에서
`delete from pm_receipts where created_by_name = '9월 시범(이관)';`
