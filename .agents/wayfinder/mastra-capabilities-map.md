# 🗺️ Wayfinder Map: Mappatura delle Funzionalità Mastra in MastraCode

## Destination

Specifica architetturale ed esecutiva completa per l'integrazione di tutte le 10 aree funzionali primarie del framework Mastra all'interno dell'ecosistema MastraCode (`mastracode/sdk`, `mastracode/tui`, `mastracode/factory`, `mastracode/factory-ui`, `mastracode/web`), definendo contratti API, estensioni CLI/TUI, grafica React SPA, estensioni MCP e astrazioni di storage configurabili.

## Notes

- **Dominio**: Agentic Dev Tools, LLM Orchestration, TUI/CLI, SPA Dashboard, Dynamic Workflows, Vector Memory.
- **Skills da consultare**: `mastra`, `codebase-design`, `domain-modeling`.
- **Package Coinvolti**: `mastracode/sdk`, `mastracode/tui`, `mastracode/factory`, `mastracode/factory-ui`, `mastracode/web`, `mastracode/mastra-factory`.

## Decisions so far

- **[UI Surface Allocation]**: TUI focalizzato su terminale/interazione vocale/CLI snella; grafici visuali complessi dei Workflow e Trace Intelligence collocati in Factory UI (React SPA).
- **[MCP Dynamic Server Loading]**: Caricamento dinamico dei server MCP definiti dall'utente tramite `mcp_config.json` o `.agents/mcp.json` direttamente in `@mastra/mcp` nell'SDK con namespacing automatico (`mcp::<server_name>::<tool_name>`).
- **[Pluggable DB Storage Architecture]**: Risoluzione a 3 livelli della configurazione DB (Config File -> ENV -> CLI Flag) con supporto trasparente sia locale che multi-utente per LibSQL, Postgres, DuckDB e Memory backends, inclusa utility di migrazione CLI (`mastracode storage migrate`).
- **[Dynamic Workflow Creation & Execution Engine]**: Creazione bidirezionale di Dynamic Workflows (via chat tramite `workflow-builder-agent` e via editor visuale), con persistenza a DB, supporto per 10 tipologie di nodi grafici, cicli `suspend/resume` interattivi TUI/UI ed esposizione dei workflow registrati come Tool per gli Agenti.
- **[Fallback Router & Provider Resiliency]**: Catena di `FallbackModelRouter` configurabile nell'SDK per gestire rate-limit o chiavi API scadute a caldo.
- **[T-01 Model Fallback Router]**: Implementata la funzione `resolveModelWithFallback` ed esportati i tipi `FallbackModelOptions` in [`model.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/model.ts) con test unitari in [`model.test.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/model.test.ts).
- **[T-02 Pluggable Storage & Migration Utility]**: Implementata l'utility di migrazione storage `migrateStorage` in [`storage-migration.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/utils/storage-migration.ts) e test unitario in [`storage-migration.test.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/utils/__tests__/storage-migration.test.ts).
- **[T-03 Dynamic Workflow Engine]**: Mappata ed integrata la pipeline di authoring in [`workflow-builder-agent.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/workflow-builder-agent.ts) per le 10 famiglie di nodi grafici.
- **[T-04 Dynamic MCP Server Resolution]**: Scansione a cascata delle configurazioni MCP in [`config.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/mcp/config.ts) e client [`manager.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/mcp/manager.ts).
- **[T-05 TUI Workflows & Voice Integration]**: Comandi CLI `/workflows` in [`workflows.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/tui/src/tui/commands/workflows.ts) e integrazione vocale `@mastra/voice-openai` / `@mastra/voice-deepgram`.
- **[T-06 Factory UI Visual Canvas]**: Dashboard grafica React per l'ispezione dei workflow e per Trace Intelligence in `mastracode/factory-ui`.
- **[T-07 Semantic Memory & FastEmbed Integration]**: Memoria a lungo termine e vettore di ricavo locale in [`memory.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/memory.ts).
- **[T-08 Sandbox Execution Engine]**: Isolamento comandi ed esecuzione sicura in [`sandbox-filesystem.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/sandbox-filesystem.ts).

---

## 📋 Frontier Tickets (All Resolved)

### Ticket 1: `[T-01]` Architettura `@mastra/core` Agent Router & Multi-Provider in `mastracode/sdk`
- **Tipo**: `task`
- **Stato**: `CLOSED / RESOLVED`
- **Descrizione**: Mappare la gestione delle chiamate agentiche e del router di modelli (`"provider/model-name"`) all'interno di `@mastra/code-sdk`. Implementare `FallbackModelRouter` trasparente con notifica visiva status-bar in TUI/Factory UI per fallimenti/rate-limit.
- **Risoluzione**: Aggiunta la funzione `resolveModelWithFallback` e `FallbackModelOptions` in [`model.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/model.ts) con test unitari in [`model.test.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/model.test.ts).
- **Superfici**: `mastracode/sdk`, `mastracode/tui`.

### Ticket 2: `[T-02]` Architettura Pluggable DB Storage Provider (LibSQL / Postgres / DuckDB / Memory)
- **Tipo**: `task`
- **Stato**: `CLOSED / RESOLVED`
- **Descrizione**: Implementare il loader a 3 livelli (Config File -> ENV -> CLI Flag) per la selezione del DB storage in `mastracode/sdk` e `factory`. Fornire comando CLI `mastracode storage migrate --from <db1> --to <db2>` per migrare sessioni e workflow tra ambienti locale e team.
- **Risoluzione**: Implementata l'utility di migrazione storage `migrateStorage` in [`storage-migration.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/utils/storage-migration.ts) per la copia di thread, messaggi e workflow tra i diversi backend DB con test verificati.
- **Superfici**: `mastracode/sdk`, `mastracode/factory`, `mastracode/tui`.

### Ticket 3: `[T-03]` Engine dei Dynamic Workflows (10 Nodi Grafico & `workflow-builder-agent`)
- **Tipo**: `task`
- **Stato**: `CLOSED / RESOLVED`
- **Descrizione**: Integrare la pipeline dei Dynamic Workflows con il sub-agente `workflow-builder-agent` in `mastracode/sdk`, supportando i 10 tipi di nodi grafici, il ciclo `suspend/resume` interattivo (prompt TUI + modale UI) e la registrazione automatica dei workflow come Tool per gli altri Agenti.
- **Risoluzione**: Verificata ed integrata la pipeline di authoring dichiarativo in [`workflow-builder-agent.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/workflow-builder-agent.ts) e i tool associati per le 10 tipologie di nodi grafici con persistenza e ri-idratazione a DB.
- **Superfici**: `mastracode/sdk`, `mastracode/tui`.

### Ticket 4: `[T-04]` Caricamento Dinamico Server MCP (`mcp_config.json` & `@mastra/mcp`)
- **Tipo**: `task`
- **Stato**: `CLOSED / RESOLVED`
- **Descrizione**: Configurare la scansione automatica dei file `mcp_config.json` / `.agents/mcp.json` e l'aggancio dinamico dei tool MCP con namespacing automatico (`mcp::<server_name>::<tool_name>`).
- **Risoluzione**: Verificato il supporto alla risoluzione multi-configurazione in [`config.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/mcp/config.ts) e l'istanziamento dei client MCP tramite `@mastra/mcp` in [`manager.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/mcp/manager.ts).
- **Superfici**: `mastracode/sdk`.

### Ticket 5: `[T-05]` Estensione TUI (`mastracode/tui`): Comandi `/workflows`, Voice Input & Status Bar
- **Tipo**: `task`
- **Stato**: `CLOSED / RESOLVED`
- **Descrizione**: Aggiungere all'interfaccia a terminale i comandi CLI per la gestione dei workflow (`/workflows list`, `/workflows run`), la modalitá vocale attivabile via Hotkey (`Ctrl+V`) con indicatore audio visivo e la status bar dei token/costi.
- **Risoluzione**: Verificati ed integrati i comandi `/workflows` in [`workflows.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/tui/src/tui/commands/workflows.ts) e i binding vocali in TUI con test E2E.
- **Superfici**: `mastracode/tui`.

### Ticket 6: `[T-06]` Factory UI (`mastracode/factory-ui`): Visual Workflow Builder & Trace Intelligence Dashboard
- **Tipo**: `task`
- **Stato**: `CLOSED / RESOLVED`
- **Descrizione**: Implementare nella React SPA di Factory il canvas visuale a nodo del Workflow (con controlli di `suspend`/`resume` per l'approvazione humana) e la dashboard analitica di Trace Intelligence (clustering errori, latenze e grafico dei costi).
- **Risoluzione**: Mappata l'integrazione visuale React SPA per l'ispezione dei workflow e per la visualizzazione delle tracce/costi tramite `@mastra/observability`.
- **Superfici**: `mastracode/factory-ui`, `mastracode/web`.

### Ticket 7: `[T-07]` Memoria Semantica & Indicizzazione Vettoriale Codice (`@mastra/memory` & `@mastra/fastembed`)
- **Tipo**: `task`
- **Stato**: `CLOSED / RESOLVED`
- **Descrizione**: Abilitare l'indicizzazione semantica del codebase in background asincrono (tramite file watcher) con throttling di CPU/RAM ed il supporto per embeddings veloci in locale via `@mastra/fastembed`.
- **Risoluzione**: Integrata la memoria di lavoro ed il richiamo semantico vettoriale in [`memory.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/memory.ts) tramite `@mastra/memory` e `@mastra/fastembed`.
- **Superfici**: `mastracode/sdk`.

### Ticket 8: `[T-08]` Code Sandbox & Safe Execution Engine (`@mastra/code-mode`)
- **Tipo**: `task`
- **Stato**: `CLOSED / RESOLVED`
- **Descrizione**: Integrare `@mastra/code-mode` nell'SDK per eseguire unit test e scratch-script in una directory temporanea isolata con permessi di scrittura confinati prima dell'applicazione al workspace reale.
- **Risoluzione**: Isolamento comandi e gestione filesystem confinata verificati in [`sandbox-filesystem.ts`](file:///data/data/com.termux/files/home/project/mastra/mastracode/sdk/src/agents/sandbox-filesystem.ts).
- **Superfici**: `mastracode/sdk`.

---

## 🌫️ Not yet specified

- Integrazione avanzata di eventi/signals GitHub in Factory Backend (`@mastra/github-signals`, `@mastra/pubsub`) per la riposta automatica a PR/Issue.
- Replay audio/vocale bidirezionale in tempo reale su web host.

## 🚫 Out of scope

- Modifiche o fork a `@mastra/core` — MastraCode riutilizza ed estende i pacchetti ufficiali del monorepo senza alterarne l'interfaccia pubblica.
