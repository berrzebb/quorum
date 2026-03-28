# Test Suites

`quorum` 테스트는 모두 Node test runner(`node --test`)를 사용한다.  
기본 실행은 전체 스위트다.

```bash
npm test
```

## Suite Commands

빠른 확인:

```bash
npm run test:smoke
```

구조/계약 확인:

```bash
npm run test:contracts
```

런타임 서브스트레이트:

```bash
npm run test:runtime
```

제공자/감사기:

```bash
npm run test:providers
```

도구/분석 엔진:

```bash
npm run test:tools
```

훅:

```bash
npm run test:hooks
```

의회/합의:

```bash
npm run test:parliament
```

오케스트레이션:

```bash
npm run test:orchestrate
```

통합:

```bash
npm run test:integration
```

사용 가능한 suite 목록:

```bash
npm run test:list
```

## Notes

- suite 정의는 [suites.mjs](/d:/Projects/quorum/tests/suites.mjs)에 있다.
- 실행기는 [run-suite.mjs](/d:/Projects/quorum/tests/run-suite.mjs)다.
- 일부 테스트는 `dist/` 산출물을 읽으므로, 필요하면 먼저 `npm run build`를 실행한다.
- `npm test`는 전체 스위트를 유지한다. 빠른 로컬 확인은 `test:smoke` 또는 해당 도메인 suite를 사용한다.
