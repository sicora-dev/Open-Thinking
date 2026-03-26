<p align="center">
  <img src="./logo.png" alt="Logo OpenThinking" width="180" />
</p>

<h1 align="center">OpenThinking</h1>

<p align="center">
  Le premier framework d’orchestration d’agents multi-LLM pour construire des pipelines, des orchestrators et des workflows IA collaboratifs.
</p>

<p align="center">
  Créez des systèmes multi-LLM avec contexte partagé, politiques d’accès et skills réutilisables, quel que soit le fournisseur.
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
  <a href="#installation">Installation</a> •
  <a href="#demarrage-rapide">Démarrage rapide</a> •
  <a href="#fonctionnalites">Fonctionnalités</a> •
  <a href="https://github.com/sicora-dev/Open-Thinking">Dépôt</a>
</p>

<p align="center">
  <a href="./README.md">English</a> • <a href="./README.es.md">Español</a> • Français
</p>

---

## Description

OpenThinking est une CLI open source pour construire des systèmes agentic avec plusieurs modèles.
Au lieu de dépendre d’un seul LLM pour tout faire, vous pouvez définir des pipelines séquentiels
ou des orchestrators dynamiques où plusieurs agents collaborent via un contexte partagé,
des politiques déclaratives et des skills réutilisables.

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
```

## Fonctionnalites

- Orchestration multi-LLM avec des modèles différents par étape ou par agent.
- Deux modes d’exécution: séquentiel et orchestrated.
- Context store partagé avec contrôle d’accès par namespace.
- Skills réutilisables avec permissions sur les outils.
- Compatibilité avec plus de 18 fournisseurs.
- CLI installable avec `npm`, `pnpm` ou `bun`.

## Prerequis

- Node.js >= 20
- macOS ou Linux
- Bun >= 1.1.0 pour le développement local et les releases

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
```

## Demarrage rapide

```bash
# 1. Initialiser un projet
openthk init my-project
cd my-project

# 2. Configurer les fournisseurs dans la REPL
openthk
# dans la REPL:
/providers setup

# 3. Exécuter un prompt
openthk run -p openthk.pipeline.yaml -i "Build a REST API for a todo app"
```

## Reference complete

La documentation technique complète et la plus à jour se trouve dans le README principal en anglais:

- [README.md](./README.md)
