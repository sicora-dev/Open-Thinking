<p align="center">
  <img src="./logo_dark.png" alt="Logo de OpenThinking" width="180" />
</p>

<h1 align="center">OpenThinking</h1>

<p align="center">
  El primer framework de orquestación de agentes multi-LLM para construir pipelines, orchestrators y workflows colaborativos de IA.
</p>

<p align="center">
  Crea sistemas multi-LLM con contexto compartido, políticas de acceso y skills reutilizables sobre cualquier proveedor.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/openthk">
    <img src="https://img.shields.io/npm/v/openthk" alt="Versión en npm" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="Licencia MIT" />
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node >= 20" />
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-1f6feb" alt="macOS y Linux" />
</p>

<p align="center">
  <a href="#instalacion">Instalación</a> •
  <a href="#inicio-rapido">Inicio rápido</a> •
  <a href="#caracteristicas">Características</a> •
  <a href="https://github.com/sicora-dev/Open-Thinking">Repositorio</a>
</p>

<p align="center">
  <a href="./README.md">English</a> • Español • <a href="./README.fr.md">Français</a>
</p>

---

## Descripción

OpenThinking es una CLI open source para construir sistemas agentic con varios modelos.
En lugar de depender de un único LLM para todo, puedes definir pipelines secuenciales
u orchestrators dinámicos donde distintos agentes colaboran usando contexto compartido,
políticas declarativas y skills reutilizables.

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

## Características

- Orquestación multi-LLM con distintos modelos por etapa o agente.
- Dos modos de ejecución: secuencial y orchestrated.
- Context store compartido con control de acceso por namespaces.
- Skills reutilizables con permisos de herramientas.
- Compatibilidad con más de 18 proveedores.
- CLI instalable con `npm`, `pnpm` o `bun`.

## Requisitos

- Node.js >= 20
- macOS o Linux
- Bun >= 1.1.0 para desarrollo local y releases

## Instalacion

```bash
# Instalación global
bun install -g openthk
npm install -g openthk
pnpm add -g openthk

# Ejecución puntual
bunx openthk --help
npx openthk --help
pnpm dlx openthk --help
```

## Inicio rapido

```bash
# 1. Crear un proyecto
openthk init my-project
cd my-project

# 2. Configurar proveedores desde la REPL
openthk
# dentro de la REPL:
/providers setup

# 3. Ejecutar un prompt
openthk run -p openthk.pipeline.yaml -i "Build a REST API for a todo app"
```

## Referencia completa

La documentación técnica completa y actualizada está en el README principal en inglés:

- [README.md](./README.md)
