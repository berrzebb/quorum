<div align="center">

# AbsoluteZero

**Systems Engineer**

`Defense` · `Maritime` · `GIS` · `AI` · `Finance`

![C++](https://img.shields.io/badge/C++-00599C?style=flat-square&logo=cplusplus&logoColor=white)
![C#](https://img.shields.io/badge/C%23-512BD4?style=flat-square&logo=dotnet&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Podman](https://img.shields.io/badge/Podman-892CA0?style=flat-square&logo=podman&logoColor=white)

[![Blog](https://img.shields.io/badge/blog-astralgate.net-1a1a2e?style=flat-square&logo=ghost)](https://blog.astralgate.net)
![Profile Views](https://komarev.com/ghpvc/?username=berrzebb&style=flat-square&color=1a1a2e)

</div>

---

15년차 시스템 엔지니어. 방위산업과 해양 도메인에서 시큐리티 크리티컬 시스템을 설계합니다. 프로젝트마다 최적의 언어를 선택합니다.

DDS 통신 스택 추상화(**C++**), MVVM 공통 인프라(**C#**), IHO 규약 해도 렌더링 엔진, 논문 기반 해양 데이터 알고리즘(**Python**), 언어 간 FFI 브릿지(**C++↔Rust, C++↔Java, C++↔C#**) — 서로 다른 시스템 사이의 추상화 레이어를 만드는 일을 합니다.

퇴근 후에는 AI 에이전트 오케스트레이션(**TypeScript**)과 알고리즘 트레이딩(**Rust**)을 만듭니다. 본업에서 단련된 "모든 엣지케이스를 찾아야 한다"는 사고방식이 취미 프로젝트에도 그대로 적용됩니다. 데이터는 내 서버 밖으로 나가지 않습니다.

---

### Featured Project

<table>
<tr>
<td>

**[quorum](https://github.com/berrzebb/quorum)** — Cross-model audit gate with structural enforcement

멀티 모델 합의 기반 코드 감사 시스템. AI가 만든 코드를 AI가 감사하되, **구조적으로 자기 평가 편향을 제거**합니다.

- **3인 의회**: Advocate / Devil's Advocate / Judge — 구현자는 진술권만, 투표 불가
- **21-gate chain**: 코드 품질 → fitness → scope → blueprint → confluence 순차 검증
- **Wave 실행**: Planner → Implementer → Self-checker → Fixer → Auditor 역할 분리
- **Runtime Evaluation Plane**: 코드 리뷰가 아닌 실제 앱 실행 기반 검증 (browser, CLI, API, artifact, data)
- **Contract Control Plane**: sprint contract 미승인 시 구현 시작 불가, threshold 미달 시 promotion 불가
- **Normal Form 수렴**: 어떤 구현자(Claude/Codex/Gemini)든 동일한 코드로 수렴 — `impl(A, law) = impl(B, law)`

`TypeScript` · `SQLite` · `Claude Code Plugin` · `1,077 tests`

> *[consensus-loop](https://github.com/berrzebb/consensus-loop)에서 출발, 의회 프로토콜 + 47개 WB platform 리팩터링으로 진화 중*

</td>
</tr>
</table>

### Other Projects

<table>
<tr>
<td width="50%">

**[SoulFlow Orchestrator](https://github.com/berrzebb/SoulFlow-Orchestrator)**

클라우드 비종속 AI 에이전트 런타임. 9개 LLM 백엔드를 CircuitBreaker로 자동 전환. 141종 노드 워크플로우 엔진.

`TypeScript` · `Redis` · `SQLite` · `Podman`

</td>
<td width="50%">

**[ZeroQuant](https://github.com/berrzebb/zeroquant)**

Rust 기반 고성능 자동화 트레이딩. Decimal 정밀도, 멱등 주문, NewType 패턴. 거래소 중립 설계.

`Rust` · `TimescaleDB` · `WebSocket`

</td>
</tr>
<tr>
<td width="50%">

**[consensus-loop](https://github.com/berrzebb/consensus-loop)**

quorum의 전신. Claude Code 훅 기반 크로스모델 감사. RTM 기반 증거, 7개 MCP 도구, 104개 테스트.

`JavaScript` · `Claude Code Hooks`

</td>
<td width="50%">

**[mcp-slack-agent-team](https://github.com/berrzebb/mcp-slack-agent-team)**

Claude Code ↔ Slack 브릿지 MCP. 에이전트 팀이 Slack 채널에서 협업.

`TypeScript` · `MCP` · `Slack API`

</td>
</tr>
</table>

### Philosophy

```
모든 것에 의문을 품어야 발전할 수 있다.
"왜 되는 거지?"도 질문이고, "왜 안 되는 거지?"도 질문이다.
```

- **Data Sovereignty** — 민감 데이터는 내 서버 밖으로 나가지 않는다
- **Edge-Case First** — 잘 되는 경우는 증명할 필요 없고, 안 되는 경우를 전부 찾아야 한다
- **Tool Layer, Not Agent Layer** — 에이전트가 판단할 필요 없는 것은 도구가 해결한다
- **Local-First AI** — Ollama로 충분한 건 Ollama로, 외부 LLM은 필요할 때만

### Career

| | Domain | Focus |
|---|--------|-------|
| **본업** | Defense · Maritime | DDS 네트워크 추상화 · MVVM 인프라 · 언어 간 FFI 브릿지 · 시큐리티 크리티컬 |
| **연구** | Geospatial · GIS | S-57/S-101 전자해도 · IHO 규약 렌더링 엔진 · 논문 기반 해양 알고리즘(**Python**) |
| **취미** | Finance | 알고리즘 트레이딩 · 백테스트 · 포트폴리오 분석 |
| **취미** | AI Infra | 로컬 퍼스트 AI 런타임 · 멀티에이전트 오케스트레이션 |

---

<div align="center">

<img src="https://github-readme-activity-graph.vercel.app/graph?username=berrzebb&theme=tokyo-night&hide_border=true&area=true" width="95%" />

<img src="https://github-readme-stats.vercel.app/api?username=berrzebb&show_icons=true&theme=tokyonight&hide_border=true&count_private=true" height="165" />
<img src="https://github-readme-stats.vercel.app/api/top-langs/?username=berrzebb&layout=compact&theme=tokyonight&hide_border=true&langs_count=8" height="165" />

[![GitHub Streak](https://github-readme-streak-stats.herokuapp.com?user=berrzebb&theme=tokyonight&hide_border=true)](https://git.io/streak-stats)

*Since 2011 · Seongnam, Korea*

</div>
