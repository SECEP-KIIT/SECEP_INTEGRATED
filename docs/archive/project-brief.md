# Project Brief — Email Classifier

## Problem
Corporate employees lose time triaging email: spotting tasks, meetings, approvals,
and credential risks buried in the inbox.

## Solution
An email intelligence system that classifies each email by type, urgency, sentiment,
and credential masking, then shows everything on a visual Kanban board with one-click
routing to Jira and Google Calendar.

## Users
Corporate employees (single organisation/tenant for now). Each organisation self-hosts
the containerised services, including model inference.

## Key differentiators
- Unified visual board + one-click action pipeline
- LLM-provider agnostic (any API key via LiteLLM)

## MVP (Phases 1–3)
1. Core classification pipeline (ingest → classify → display)
2. Task/Jira loop + core dashboard UX
3. Security layer (credential masking) — runs in parallel

## Out of scope for v1
- Self-learning / personalisation loop (post-launch)
- Multi-tenant support
