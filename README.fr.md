<p align="center">
  <img src="./logo_dark.png" alt="Logo OpenThinking" width="180" />
</p>

<h1 align="center">OpenThinking</h1>

<p align="center">
  Le premier framework d’orchestration d’agents multi-LLM pour construire des pipelines, des orchestrators et des workflows IA collaboratifs.
</p>

<p align="center">
  Construisez des systèmes multi-LLM avec contexte partagé, politiques d’accès et skills réutilisables sur n’importe quel fournisseur.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/openthk">
    <img src="https://img.shields.io/npm/v/openthk" alt="Version npm" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="Licence MIT" />
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node >= 20" />
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-1f6feb" alt="macOS et Linux" />
</p>

<p align="center">
  <a href="#installation">Installer</a> •
  <a href="#démarrage-rapide">Démarrage rapide</a> •
  <a href="#fonctionnalités">Fonctionnalités</a> •
  <a href="#architecture">Architecture</a> •
  <a href="https://github.com/sicora-dev/Open-Thinking">Dépôt</a>
</p>

<p align="center">
  <a href="./README.md">English</a> • <a href="./README.es.md">Español</a> • Français
</p>

---

```yaml
# openthk.pipeline.yaml
name: feature-development
version: "1.0"

providers:
  - anthropic
  - openai

stages:
  planning:
    provider: anthropic
    model: claude-opus-4-5-20250520
    skill: core/arch-planner@1.0
    context:
      read: ["input.*"]
      write: ["plan.*"]

  develop:
    provider: openai
    model: gpt-4o
    skill: core/code-writer@1.0
    context:
      read: ["input.*", "plan.*"]
      write: ["code.*"]
    depends_on: [planning]

  testing:
    provider: anthropic
    model: claude-sonnet-4-20250514
    skill: core/test-gen@1.0
    context:
      read: ["plan.*", "code.*"]
      write: ["test.*"]
    depends_on: [develop]
```

## Table des matières

- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Démarrage rapide](#démarrage-rapide)
- [Référence CLI](#référence-cli)
  - [REPL interactive](#repl-interactive)
  - [Commandes directes](#commandes-directes)
  - [Commandes slash de la REPL](#commandes-slash-de-la-repl)
- [Configuration du pipeline](#configuration-du-pipeline)
  - [Schéma YAML complet](#schéma-yaml-complet)
  - [Modes d’exécution](#modes-dexécution)
  - [Résolution des fournisseurs](#résolution-des-fournisseurs)
  - [Namespaces du contexte](#namespaces-du-contexte)
  - [Gestion des échecs](#gestion-des-échecs)
- [Fournisseurs](#fournisseurs)
  - [Fournisseurs pris en charge](#fournisseurs-pris-en-charge)
  - [Configuration des fournisseurs](#configuration-des-fournisseurs)
  - [Fournisseurs personnalisés](#fournisseurs-personnalisés)
  - [Résilience des fournisseurs](#résilience-des-fournisseurs)
- [Skills](#skills)
  - [Structure d’une skill](#structure-dune-skill)
  - [Manifest de la skill](#manifest-de-la-skill)
  - [Permissions des outils](#permissions-des-outils)
  - [Skills intégrées](#skills-intégrées)
- [Outils intégrés](#outils-intégrés)
- [Boucle agentique](#boucle-agentique)
- [Store de contexte](#store-de-contexte)
- [Moteur de politiques](#moteur-de-politiques)
- [Structure du workspace](#structure-du-workspace)
- [Architecture](#architecture)
- [Développement](#développement)
- [Licence](#licence)

## Fonctionnalités

- **Orchestration multi-LLM** — Assignez différents modèles à différentes étapes. Opus planifie, GPT-4o code, Sonnet teste.
- **Deux modes d’exécution** — Séquentiel (DAG avec étapes indépendantes en parallèle) ou orchestrated (un LLM délègue dynamiquement à des agents).
- **Store de contexte partagé** — Store clé-valeur basé sur SQLite avec contrôle d’accès par namespace. Les étapes déclarent ce qu’elles peuvent lire et écrire.
- **18+ fournisseurs** — OpenAI, Anthropic, Google, Mistral, xAI, DeepSeek, Groq, Together, Fireworks, OpenRouter, Perplexity, Cohere, Azure, Bedrock, Ollama, LM Studio, llama.cpp.
- **Skills réutilisables** — Emballez prompts et permissions d’outils sous forme de définitions de skills portables. Utilisez celles intégrées ou créez les vôtres.
- **Politiques déclaratives** — Rate limits, plafonds de coût et audit définis dans le YAML du pipeline.
- **Résilience des fournisseurs** — Backoff exponentiel avec jitter, rate limiting via token bucket et chaînes de fallback de modèles quand les retries sur rate limit sont épuisés.
- **REPL interactive** — Lancez `openthk` pour ouvrir un shell interactif avec slash commands, tab completion et exécution de pipelines en langage naturel.
- **CLI compatible avec les gestionnaires de paquets** — Installez-la avec `npm`, `pnpm` ou `bun`. Vous pouvez aussi compiler un binaire standalone pour une distribution locale.

## Prérequis

- Node.js >= 20
- macOS ou Linux
- [Bun](https://bun.sh) >= 1.1.0 pour le développement local et les builds de release

## Installation

```bash
# Installation globale
bun install -g openthk
npm install -g openthk
pnpm add -g openthk

# Exécution ponctuelle
bunx openthk --help
npx openthk --help
pnpm dlx openthk --help

# Depuis le code source
git clone https://github.com/sicora-dev/Open-Thinking.git
cd Open-Thinking
bun install
bun run build         # CLI du package npm -> dist/cli/index.cjs
bun run build:binary  # binaire standalone optionnel -> dist/openthk
```

## Démarrage rapide

```bash
# 1. Initialiser un nouveau projet
openthk init my-project
cd my-project

# 2. Configurer vos fournisseurs LLM (wizard interactif avec navigation au clavier)
openthk
# puis dans la REPL:
/providers setup

# 3. Tapez un prompt pour exécuter le pipeline par défaut
> Build a REST API for a todo app with CRUD endpoints
```

Ou exécutez un pipeline directement sans passer par la REPL:

```bash
openthk run -p openthk.pipeline.yaml -i "Build a REST API for a todo app"
```

## Référence CLI

### REPL interactive

```bash
openthk
```

Ouvre un shell interactif. Tapez du langage naturel pour exécuter le pipeline chargé, ou utilisez des slash commands pour configurer les fournisseurs, inspecter les étapes et gérer les pipelines.

La REPL résout automatiquement un pipeline au démarrage dans cet ordre:

1. Pipeline actif défini via `/pipeline switch <name>`
2. Pipeline par défaut défini via `/pipeline default <name>`
3. Auto-détection de `openthk.pipeline.yaml` ou `pipeline.yaml` dans le répertoire courant

### Commandes directes

#### `openthk init [name]`

Scaffold d’un nouveau projet.

```bash
openthk init my-project    # Créer dans un nouveau répertoire
openthk init               # Initialiser dans le répertoire courant
```

Crée:
- `.openthk/pipelines/default.yaml` — Modèle initial de pipeline
- `.openthk/project.md` — Description du projet (contexte partagé pour toutes les étapes)
- `.openthk/stages/` — Instructions par étape
- `.openthk/history/` — Logs d’historique d’exécution
- `.openthk/learned/` — Apprentissages issus des exécutions précédentes
- `skills/` — Définitions locales de skills
- `openthk.pipeline.yaml` — Fichier pipeline racine (compatibilité rétroactive)

#### `openthk run`

Exécute un pipeline.

```bash
openthk run -p <path> -i <prompt> [options]
```

| Flag | Description |
|---|---|
| `-p, --pipeline <path>` | Chemin vers le fichier YAML du pipeline (obligatoire) |
| `-i, --input <text>` | Prompt d’entrée pour le pipeline (obligatoire) |
| `-s, --stage <name>` | Exécuter une seule étape |
| `--dry-run` | Afficher le plan d’exécution sans l’exécuter |
| `--skills-dir <path>` | Répertoire des skills (par défaut: `skills/` à côté du pipeline) |

Exemples:

```bash
# Exécuter le pipeline complet
openthk run -p openthk.pipeline.yaml -i "Build a REST API for user management"

# Exécuter une seule étape
openthk run -p pipeline.yaml -i "Write unit tests" --stage testing

# Prévisualiser le plan d’exécution
openthk run -p pipeline.yaml -i "Refactor auth module" --dry-run
```

#### `openthk validate`

Valide un fichier YAML de pipeline sans l’exécuter.

```bash
openthk validate [-f <path>]
```

| Flag | Description |
|---|---|
| `-f, --file <path>` | Chemin du fichier pipeline (par défaut: `openthk.pipeline.yaml`) |

Vérifie: syntaxe YAML, champs obligatoires, graphe de dépendances des étapes (dépendances circulaires), références de fournisseurs et configuration des politiques.

#### `openthk provider`

Gère les fournisseurs depuis la CLI directe.

```bash
# Lister les fournisseurs définis dans un pipeline
openthk provider list [-f <path>]

# Tester la connexion à un fournisseur
openthk provider test <name> [-f <path>]
```

| Sous-commande | Description |
|---|---|
| `list` | Liste tous les fournisseurs du pipeline avec leurs base URLs résolues |
| `test <name>` | Envoie une requête de test pour vérifier que le fournisseur est joignable et que l’API key fonctionne |

#### `openthk context`

Gère le store de contexte partagé.

```bash
# Inspecter toutes les entrées (ou filtrer par préfixe)
openthk context inspect [-p <prefix>] [-d <db-path>]

# Effacer tout le contexte
openthk context clear -y [-d <db-path>]
```

| Flag | Description |
|---|---|
| `-p, --prefix <prefix>` | Filtrer les entrées par préfixe de clé (par ex. `plan.`) |
| `-d, --db <path>` | Chemin de la base de données (par défaut: `.openthk/context.db`) |
| `-y, --yes` | Ignore la confirmation avant l’effacement |

### Commandes slash de la REPL

| Commande | Aliases | Description |
|---|---|---|
| `/help` | `/h`, `/?` | Afficher toutes les commandes disponibles |
| `/pipeline` | `/p` | Afficher le design du pipeline actuel (étapes, dépendances, modèles) |
| `/pipeline list` | | Lister tous les pipelines disponibles (niveau projet + utilisateur) |
| `/pipeline switch <name>` | | Passer à un autre pipeline |
| `/pipeline add <path> [project\|user]` | | Enregistrer un fichier YAML de pipeline |
| `/pipeline remove <name> [project\|user]` | | Supprimer un pipeline enregistré |
| `/pipeline default <name> <project\|user\|clear>` | | Définir ou supprimer le pipeline par défaut |
| `/pipeline load <path>` | | Charger un fichier YAML de pipeline depuis un chemin |
| `/pipeline refresh [name]` | | Recharger un pipeline depuis le disque |
| `/providers setup` | | Wizard interactif de configuration des fournisseurs (navigation au clavier) |
| `/providers list` | `/provider list` | Lister toutes les API keys configurées globalement |
| `/providers remove <id>` | `/provider rm <id>` | Supprimer l’API key d’un fournisseur |
| `/model` | `/m` | Afficher l’affectation des modèles par étape |
| `/stages` | `/s` | Afficher le graphe de dépendances des étapes |
| `/skills` | | Lister les skills disponibles dans le répertoire des skills |
| `/context inspect` | `/ctx inspect` | Afficher les entrées du store de contexte |
| `/context clear` | `/ctx clear` | Effacer le store de contexte |
| `/clear` | | Effacer le terminal |
| `/exit` | `/quit`, `/q` | Quitter la REPL |

## Configuration du pipeline

### Schéma YAML complet

```yaml
name: string                    # Nom du pipeline (obligatoire)
version: string                 # Version semver (obligatoire)
mode: sequential | orchestrated # Mode d’exécution (par défaut: sequential)

context:                        # Optionnel — valeurs par défaut affichées
  backend: sqlite | postgres    # Backend de stockage (par défaut: sqlite)
  vector: embedded | qdrant     # Backend de recherche vectorielle (par défaut: embedded)
  ttl: string                   # Expiration du contexte (par défaut: "7d")

providers:                      # Obligatoire — au moins un
  - openai                      # Nom du catalogue → résolution automatique
  - anthropic
  - ollama
  - id: my-custom               # Fournisseur personnalisé (hors catalogue)
    base_url: https://api.example.com/v1
    api_key: ${MY_API_KEY}      # Interpolation de variable d’environnement

stages:                         # Obligatoire — au moins une
  [stage_name]:
    provider: string            # Doit correspondre à un nom de la liste providers (obligatoire)
    model: string               # Identifiant du modèle (obligatoire)
    skill: string               # Référence de skill: namespace/name@version
    context:
      read: string[]            # Patterns glob des clés de contexte lisibles
      write: string[]           # Patterns glob des clés de contexte écrites
    depends_on: string[]        # Dépendances d’étape (mode sequential)
    max_tokens: number          # Max tokens de sortie par requête LLM
    temperature: number         # Température d’échantillonnage (0–2)
    timeout: number             # Timeout de requête en secondes (par défaut: 120)
    max_iterations: number      # Max itérations de la boucle agentique (par défaut: 50)
    role: orchestrator          # Marque comme orchestrator (mode orchestrated seulement)
    allowed_tools: string[]     # Surcharge les permissions d’outils par défaut de la skill
    fallback_models: string[]   # Modèles de fallback en cas d’épuisement du rate limit
    on_fail:
      retry_stage: string       # Étape à relancer en cas d’échec
      max_retries: number       # Nombre maximal de retries
      inject_context: string    # Clé de contexte où injecter les détails de l’échec

policies:                       # Optionnel
  global:
    rate_limit: string          # Rate limit par étape (par ex. "100/hour")
    audit_log: boolean          # Activer l’audit
    cost_limit: string          # Plafond de coût par exécution (par ex. "$50/run")
```

### Modes d’exécution

#### Séquentiel (par défaut)

Les étapes s’exécutent dans l’ordre défini par `depends_on`. Les étapes indépendantes (sans dépendances partagées) s’exécutent en parallèle.

```yaml
stages:
  planning:
    provider: anthropic
    model: claude-sonnet-4-20250514
    # sans depends_on → s’exécute en premier

  develop:
    provider: openai
    model: gpt-4o
    depends_on: [planning]       # attend planning

  lint:
    provider: openai
    model: gpt-4o-mini
    depends_on: [planning]       # attend aussi planning, mais s’exécute en parallèle avec develop

  testing:
    provider: anthropic
    model: claude-sonnet-4-20250514
    depends_on: [develop, lint]  # attend les deux
```

Plan d’exécution:
```
Layer 1:  planning
Layer 2:  develop, lint          (parallel)
Layer 3:  testing
```

#### Orchestré

Une étape est marquée `role: orchestrator`. Elle reçoit un outil `delegate` et décide dynamiquement quels agents invoquer et dans quel ordre. Toutes les autres étapes sont disponibles en tant qu’agents.

```yaml
mode: orchestrated

stages:
  orchestrator:
    provider: anthropic
    model: claude-opus-4-5-20250520
    role: orchestrator
    skill: core/orchestrator@1.0
    context:
      read: ["*"]
      write: ["orchestrator.*"]
    timeout: 600

  architect:
    provider: anthropic
    model: claude-sonnet-4-20250514
    skill: core/arch-planner@1.0
    context:
      read: ["input.*", "*.output"]
      write: ["architect.*"]
    allowed_tools: [read_file, list_files, search_files]

  coder:
    provider: openai
    model: gpt-4o
    skill: core/code-writer@1.0
    context:
      read: ["input.*", "architect.*"]
      write: ["code.*"]

  tester:
    provider: openai
    model: gpt-4o
    skill: core/test-writer@1.0
    context:
      read: ["*"]
      write: ["test.*"]
```

L’orchestrator appelle les agents via l’outil `delegate`:

```
delegate(agent: "architect", task: "Analyze the requirements and propose a database schema")
→ exécute la boucle agentique complète de l’architect
→ la sortie est stockée dans le contexte sous architect.output
→ l’orchestrator lit le résultat et décide de l’étape suivante

delegate(agent: "coder", task: "Implement the schema from the architect's plan")
→ exécute la boucle agentique complète du coder
→ ...
```

Les agents peuvent être appelés plusieurs fois avec des tâches différentes. Chaque agent respecte sa propre skill, ses outils et ses permissions de contexte.

### Résolution des fournisseurs

Dans le YAML, les fournisseurs sont déclarés par nom. Le parser les résout automatiquement:

1. **Base URL** — Cherchée dans le catalogue intégré des fournisseurs (`src/config/provider-catalog.ts`)
2. **API key** — Cherchée dans `~/.openthk/providers.json` (configuré via `/providers setup`)
3. **Fallback** — Si absente de la configuration globale, vérifie la variable d’environnement (par ex. `OPENAI_API_KEY`)

Les utilisateurs n’ont jamais besoin d’écrire `type`, `base_url` ou `api_key` dans le YAML pour les fournisseurs connus.

Les fournisseurs personnalisés hors catalogue utilisent la forme objet:

```yaml
providers:
  - id: my-llm
    base_url: https://api.example.com/v1
    api_key: ${MY_LLM_KEY}
```

### Namespaces du contexte

Les clés utilisent une notation par points. Les étapes déclarent les accès en lecture/écriture à l’aide de patterns glob.

| Pattern | Correspond à |
|---|---|
| `input.*` | `input.prompt`, `input.files`, etc. |
| `plan.*` | `plan.architecture`, `plan.decisions`, etc. |
| `code.*` | `code.files`, `code.summary`, etc. |
| `test.*` | `test.results`, `test.failures`, etc. |
| `*.output` | `architect.output`, `coder.output`, etc. |
| `*` | Tout |

Une étape qui tente de lire ou d’écrire en dehors de ses patterns déclarés reçoit une erreur de politique stricte.

### Gestion des échecs

```yaml
stages:
  testing:
    provider: openai
    model: gpt-4o
    on_fail:
      retry_stage: develop      # Relancer l’étape develop
      max_retries: 3            # Jusqu’à 3 retries
      inject_context: test.failures  # Passer les détails d’échec à l’étape relancée
```

Quand une étape échoue, l’exécuteur peut relancer une étape précédente avec le contexte d’échec injecté, créant ainsi une boucle de feedback.

## Fournisseurs

### Fournisseurs pris en charge

**Cloud**:

| ID | Fournisseur | Modèles d’exemple |
|---|---|---|
| `openai` | OpenAI | `gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini` |
| `anthropic` | Anthropic | `claude-opus-4-5-20250520`, `claude-sonnet-4-20250514`, `claude-haiku-4-5-20251001` |
| `google` | Google AI | `gemini-2.5-pro`, `gemini-2.5-flash` |
| `mistral` | Mistral AI | `mistral-large-latest`, `codestral-latest` |
| `xai` | xAI | `grok-3`, `grok-3-mini` |
| `deepseek` | DeepSeek | `deepseek-chat`, `deepseek-reasoner` |
| `groq` | Groq | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` |
| `together` | Together AI | `meta-llama/Llama-3-70b-chat-hf` |
| `fireworks` | Fireworks AI | `accounts/fireworks/models/llama-v3p1-70b-instruct` |
| `openrouter` | OpenRouter | N’importe quel modèle via une API unifiée |
| `perplexity` | Perplexity | `sonar-pro`, `sonar` |
| `cohere` | Cohere | `command-r-plus`, `command-r` |

**Infrastructure cloud**:

| ID | Fournisseur | Notes |
|---|---|---|
| `azure` | Azure OpenAI | Déploiements OpenAI en entreprise |
| `bedrock` | AWS Bedrock | Claude, Llama et Titan via AWS |

**Local**:

| ID | Fournisseur | URL par défaut |
|---|---|---|
| `ollama` | Ollama | `http://localhost:11434` |
| `lmstudio` | LM Studio | `http://localhost:1234/v1` |
| `llamacpp` | llama.cpp | `http://localhost:8080/v1` |

### Configuration des fournisseurs

Les API keys sont stockées globalement dans `~/.openthk/providers.json` (permissions du fichier: `0o600`). Elles persistent entre tous les projets.

```bash
# Configuration interactive (recommandée)
openthk
/providers setup
# → sélection des fournisseurs avec les flèches
# → saisie de l’API key (masquée par des puces)

# Lister les fournisseurs configurés
/providers list

# Supprimer un fournisseur
/providers remove openai
```

Vous pouvez aussi définir les API keys via des variables d’environnement:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

Ordre de résolution: configuration globale (`~/.openthk/providers.json`) > variable d’environnement.

### Fournisseurs personnalisés

Toute API compatible OpenAI peut être utilisée comme fournisseur personnalisé:

```yaml
providers:
  - id: my-llm
    base_url: https://api.example.com/v1
    api_key: ${MY_LLM_KEY}

stages:
  coder:
    provider: my-llm
    model: my-model-name
```

### Résilience des fournisseurs

Tous les appels aux fournisseurs incluent une résilience intégrée:

**Retry avec backoff** — Les requêtes échouées sont retentées avec backoff exponentiel et jitter. Conditions retentables: HTTP 429 (rate limit), 502/503 (erreurs serveur), erreurs réseau (ETIMEDOUT, ECONNRESET). L’en-tête `Retry-After` est respecté lorsqu’il est présent.

| Réglage | Valeur par défaut |
|---|---|
| Max retries | 3 |
| Délai de base | 1s |
| Délai max | 60s |
| Jitter | 500ms |

**Rate limiting** — Un algorithme token-bucket limite les requêtes par fournisseur pour éviter proactivement les erreurs 429. Chaque fournisseur possède son propre bucket rechargé en continu.

**Fallback de modèles** — Lorsqu’un modèle est rate-limité et que tous les retries sont épuisés, l’exécuteur essaie le modèle suivant de la chaîne `fallback_models`:

```yaml
stages:
  coder:
    provider: openai
    model: gpt-4o
    fallback_models:
      - gpt-4o-mini
      - gpt-3.5-turbo
```

**Suivi des tokens** — Les tokens de prompt et de completion sont suivis par étape pour le calcul des coûts et l’application des politiques.

## Skills

### Structure d’une skill

Une skill est un répertoire contenant deux fichiers:

```
skills/core/arch-planner/
├── prompt.md       # Prompt système envoyé au LLM
└── skill.yaml      # Manifest: métadonnées, permissions d’outils, contraintes
```

Le `prompt.md` est injecté comme system prompt pour l’étape. Le `skill.yaml` déclare quels outils la skill nécessite et quelles clés de contexte elle lit/écrit.

### Manifest de la skill

```yaml
name: arch-planner
version: "1.0"
description: Analyse les exigences et produit un plan d’architecture technique.

context:
  reads: ["input.*"]
  writes: ["planner.*"]

# Permissions d’outils — appliquées au niveau du registre.
# Si un outil n’est pas listé, le LLM ne peut pas l’appeler.
allowed_tools:
  - read_file
  - list_files
  - search_files

constraints:
  min_tokens: 4000
  recommended_models: [claude-opus-4-5-20250520, gpt-4o]
```

### Permissions des outils

Il n’existe pas de types d’étapes codés en dur. Chaque auteur de skill décide de ce que sa skill peut faire. L’accès aux outils est appliqué au niveau du registre d’outils: si un outil n’est pas dans la liste autorisée, le LLM ne peut pas l’invoquer, même s’il le demande.

**Ordre de résolution** (la première correspondance gagne):

1. `allowed_tools` dans le YAML du pipeline — surcharge utilisateur, contrôle total
2. `allowed_tools` dans `skill.yaml` — valeur par défaut définie par l’auteur de la skill
3. Tous les outils — fallback si aucun des deux ne le définit

Exemple de surcharge dans le pipeline:

```yaml
stages:
  coder:
    skill: core/code-writer@1.0
    allowed_tools: [read_file, list_files]   # restreint: pas de write_file ni de run_command
```

### Skills intégrées

| Skill | Description | Outils par défaut |
|---|---|---|
| `core/arch-planner@1.0` | Analyse les exigences et produit un plan technique | `read_file`, `list_files`, `search_files` |
| `core/code-writer@1.0` | Implémente le code à partir d’un plan | `read_file`, `write_file`, `list_files`, `run_command`, `search_files` |
| `core/test-writer@1.0` | Génère des tests pour le code implémenté | `read_file`, `write_file`, `list_files`, `run_command`, `search_files` |
| `core/orchestrator@1.0` | Orchestre des workflows multi-agents | `delegate` (auto-injecté) |

## Outils intégrés

Chaque étape de la boucle agentique a accès à ces outils filesystem (sous réserve des permissions de la skill):

### `read_file`

Lit le contenu d’un fichier.

| Paramètre | Type | Description |
|---|---|---|
| `path` | string | Chemin du fichier relatif à la racine du projet |

Retourne le contenu du fichier sous forme de chaîne. Les fichiers de plus de 100KB sont tronqués. Le path traversal en dehors de la racine du projet est bloqué.

### `write_file`

Crée ou écrase un fichier.

| Paramètre | Type | Description |
|---|---|---|
| `path` | string | Chemin du fichier relatif à la racine du projet |
| `content` | string | Contenu du fichier |

Crée automatiquement les répertoires parents. Retourne le nombre d’octets écrits.

### `list_files`

Liste les fichiers et répertoires.

| Paramètre | Type | Par défaut | Description |
|---|---|---|---|
| `path` | string | `.` | Répertoire à lister |
| `recursive` | boolean | `false` | Parcourir récursivement les sous-répertoires |

Retourne des chemins séparés par des sauts de ligne. Les répertoires ont un suffixe `/`. Ignore `node_modules` et `.git`. Limité à 500 entrées.

### `run_command`

Exécute une commande shell.

| Paramètre | Type | Par défaut | Description |
|---|---|---|---|
| `command` | string | — | Commande shell à exécuter |
| `timeout_ms` | number | `30000` | Timeout en millisecondes |

Retourne stdout et stderr combinés. La sortie est tronquée à 50KB. S’exécute dans le répertoire de travail du projet.

### `search_files`

Recherche dans le contenu des fichiers à l’aide d’expressions régulières.

| Paramètre | Type | Par défaut | Description |
|---|---|---|---|
| `pattern` | string | — | Expression régulière à rechercher |
| `path` | string | `.` | Répertoire dans lequel chercher |
| `glob` | string | — | Filtre de fichiers (par ex. `*.ts`, `*.py`) |

Retourne les résultats au format `path:line_number: matched_line`. Limité à 100 résultats.

### `delegate` (mode orchestrated uniquement)

Invoque dynamiquement une étape-agent. Disponible uniquement pour l’orchestrator.

| Paramètre | Type | Description |
|---|---|---|
| `agent` | string | Nom de l’étape à invoquer |
| `task` | string | Description de tâche / prompt |

Exécute la boucle agentique complète de l’agent et retourne sa sortie finale. La sortie est également écrite dans le store de contexte sous `<agent>.output`.

## Boucle agentique

Chaque étape exécute une boucle agentique itérative: envoyer un prompt au LLM, exécuter les appels d’outils qu’il retourne, réinjecter les résultats, puis répéter jusqu’à ce que le LLM cesse de demander des outils ou qu’une limite soit atteinte.

### Efficacité des tokens

**Mémoire de travail** — Au lieu d’accumuler tout l’historique des messages (qui croît quadratiquement en tokens), la boucle maintient une working memory compressée (journal d’actions + notes du modèle). Avant chaque appel au LLM, le contexte est reconstruit sous la forme `[task + working memory] + [last exchange only]`.

**Troncature des sorties d’outils** — Les grosses sorties d’outils (>2000 lignes ou 50KB) sont tronquées aux 200 premières lignes + 100 dernières lignes avec une note d’omission. Cela évite qu’un seul `run_command` ou `read_file` consomme toute la fenêtre de contexte.

### Mécanismes de sécurité

**Détection des doom loops** — Si le LLM effectue 3 appels d’outil identiques consécutifs, la boucle retourne le résultat en cache au lieu de le réexécuter, ce qui casse les boucles infinies.

**Arrêt progressif** — Lorsque `max_iterations` approche de la limite, la boucle déclenche une séquence de fermeture qui demande au modèle de résumer son travail et de s’arrêter proprement, évitant une terminaison brutale au milieu d’une tâche.

**Annulation** — Ctrl+C pendant l’exécution du pipeline propage un `AbortSignal` qui annule proprement la boucle agentique en cours.

### Configuration

| Option | Par défaut | Description |
|---|---|---|
| `max_iterations` | 50 | Nombre maximal d’allers-retours LLM par étape |
| `timeout` | 120 | Secondes par requête LLM individuelle |
| `max_tokens` | — | Nombre maximal de tokens de sortie par réponse LLM |
| `temperature` | — | Température d’échantillonnage (0–2) |

### Sortie

Chaque boucle agentique produit:

```typescript
type AgentLoopResult = {
  finalContent: string;        // Dernier message de l’assistant
  totalUsage: TokenUsage;      // { prompt, completion, total }
  iterations: number;          // Nombre d’appels LLM effectués
  stopReason: "done" | "cancelled" | "max_iterations" | "token_limit" | "error";
  workSummary: {
    filesWritten: string[];
    commandsRun: string[];
  };
};
```

## Store de contexte

Store clé-valeur basé sur SQLite où les étapes partagent des données. Chaque entrée possède une clé (notation par points), une valeur, un créateur et un TTL optionnel.

```
plan.architecture  →  "## Architecture\n\nWe'll use a layered..."  (created by: planning)
code.files         →  "src/api/routes.ts, src/api/handlers.ts"     (created by: develop)
test.results       →  "12 passed, 0 failed"                        (created by: testing)
```

L’accès est contrôlé par des patterns glob déclarés dans `context.read` et `context.write` de chaque étape. Le moteur de politiques évalue chaque opération de lecture/écriture avant son exécution.

Le contexte expire selon le paramètre `ttl` du pipeline (7 jours par défaut). Les entrées expirées sont supprimées lors du prochain accès.

## Moteur de politiques

Les politiques sont définies dans le YAML du pipeline et appliquées automatiquement:

```yaml
policies:
  global:
    rate_limit: "100/hour"     # Nombre maximal de requêtes LLM par étape et par heure
    audit_log: true            # Journaliser toutes les lectures/écritures de contexte et les tool calls
    cost_limit: "$50/run"      # Coût maximal par exécution du pipeline
```

**Contrôle d’accès au contexte** — Chaque étape déclare des patterns glob `read` et `write`. Le moteur de politiques évalue chaque opération de contexte. Si une étape tente de lire `code.*` alors qu’elle n’a que `read: ["input.*"]`, elle reçoit une `PolicyError` avec le code `READ_DENIED`.

**Rate limiting** — Appliqué par étape. Dépasser la limite produit une erreur `RATE_EXCEEDED`.

**Suivi des coûts** — L’usage des tokens est suivi par étape puis accumulé. Dépasser `cost_limit` arrête le pipeline avec une erreur `COST_EXCEEDED`.

## Structure du workspace

### Global (`~/.openthk/`)

Créé lors du premier lancement. Stocke la configuration persistante partagée entre tous les projets.

```
~/.openthk/
├── providers.json       # API keys (permissions 0o600)
├── pipelines/           # Définitions de pipelines au niveau utilisateur
├── learned/             # Apprentissages globaux entre projets
└── user.md              # Préférences utilisateur (partagées avec toutes les étapes)
```

### Par projet (`.openthk/`)

Créé par `openthk init`. Stocke l’état spécifique au projet.

```
.openthk/
├── pipelines/           # Définitions de pipelines du projet
│   └── default.yaml
├── project.md           # "Âme" du projet — description partagée avec toutes les étapes
├── stages/              # Instructions par étape (par ex. coder.md)
├── context.db           # Store de contexte SQLite
├── history/             # Logs d’exécution (un fichier par exécution)
├── learned/             # Apprentissages spécifiques au projet
├── active-pipeline      # Pointeur vers le nom du pipeline courant
└── .gitignore           # Exclut automatiquement context.db, history/, active-pipeline
```

## Architecture

```
src/
├── cli/                  # Point d’entrée CLI et REPL interactive
│   ├── commands/         # Commandes directes (init, run, validate, provider, context)
│   └── repl/             # REPL interactive, slash commands, tab completion
├── config/               # Configuration globale (~/.openthk/)
│   ├── global-config     # Stockage des API keys (providers.json)
│   ├── provider-catalog  # Définitions intégrées de fournisseurs (18+ fournisseurs)
│   └── setup-wizard      # Configuration interactive des fournisseurs avec navigation au clavier
├── core/
│   └── events/           # Event bus pour le cycle de vie des étapes (start, complete, error, tool call)
├── pipeline/
│   ├── parser/           # Parser YAML + validateur + résolveur de fournisseurs
│   └── executor/         # Exécuteur de DAG, boucle agentique, working memory, détection de doom loops
├── providers/
│   ├── adapters/         # Adaptateurs de protocole (OpenAI-compat, traduction Anthropic, Ollama)
│   └── resilience/       # Retry (backoff exponentiel), rate limiter (token bucket), token tracker
├── tools/                # Outils intégrés (read_file, write_file, list_files, run_command, search_files, delegate)
├── context/
│   └── store/            # Store clé-valeur SQLite avec contrôle d’accès par namespace
├── skills/               # Chargeur de skills (prompt.md + skill.yaml)
├── policies/
│   └── engine/           # Évaluation des politiques (glob matching, rate limits, plafonds de coût)
├── workspace/            # Gestion de .openthk/ et ~/.openthk/, historique, apprentissages
└── shared/               # Types, pattern Result<T,E>, erreurs, logger
```

Tous les fournisseurs LLM sont accessibles via une interface compatible OpenAI. Les fournisseurs qui ne la supportent pas nativement (Anthropic) utilisent un adaptateur de traduction. Cela signifie qu’ajouter un nouveau fournisseur revient seulement à mapper son API vers le format OpenAI chat completion.

La gestion d’erreurs utilise le pattern `Result<T, E>` partout — aucune exception dans la logique centrale.

```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

const result = await parsePipeline("pipeline.yaml");
if (!result.ok) {
  console.error(result.error.message);
  return;
}
const config = result.value;
```

## Développement

```bash
# Installer les dépendances
bun install

# Lancer en mode développement
bun run dev

# Exécuter avec des arguments
bun run dev -- run -p pipeline.yaml -i "test prompt"

# Lancer les tests
bun test

# Lancer un fichier de test spécifique
bun test src/pipeline/parser/pipeline-parser.test.ts

# Type checking
bun run typecheck

# Lint
bun run lint

# Format
bun run format

# Construire la CLI du package npm
bun run build
# → dist/cli/index.cjs

# Binaire standalone optionnel
bun run build:binary
# → dist/openthk
```

## Licence

MIT — voir [LICENSE](LICENSE).
