SRS v1.0 · §2.1, §3 · UML activity diagram

# SECEP email processing activity

How one new Gmail message moves through ingestion, triage, enrichment and link checks until the user accepts an action and it lands in Jira and on the board.

System

Smart Email Classifier Enterprise Platform

Partitions

M2, M3, M4, M5, M6, user (M8)

Fast path

≤ 800 ms p95, fetch to dashboard

Drawn

28 Oct 2026

Initial Action Synchronous fast-path action Decision / merge Fork / join Flow final Activity final `emails.triaged`Redis stream on the edge

The diagram is 1770 px wide; scroll inside the frame or fit it to the page.

## Three parallel branches

After `emails.ingested` the flow forks: triage runs on the fast path while the security branch scores links. After `emails.triaged` it forks again: the API pushes labels at once and the decoder enriches in the background.

## Why the join sits with the user

A user can only review a proposed action after both the labels and the decoder's enrichment have arrived. The join bar in the user lane marks that point. The security warning arrives independently.

## Not drawn here

The offline training and continual-learning flow is the SRS §5 diagram. The click-time link resolver (FR-SEC-004/005), credential reveal and admin settings are separate activities.