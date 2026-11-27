# 8. Difficulty-balanced random papers

- Status: Accepted
- Date: 2026-11-27

## Context

Plain random selection can give one candidate mostly hard questions and another mostly easy ones (innovation challenge 5.2). Papers must still differ between candidates.

## Decision

In balanced mode the examiner sets the number of questions and the percentage of easy, medium and hard. Every question carries a required difficulty label. Each attempt gets its own random draw with the same count at each level; within a level the draw rotates across topics. Marks are set per level, so every paper has the same total. Publishing is blocked if the pool cannot fill a level. After the exam, observed difficulty is compared with the labels and outliers are flagged.

## Consequences

- All papers have the same difficulty mix and total marks while differing in content.
- Fairness depends on honest labels; the post-exam report exposes mislabelled questions.
- Scores are never adjusted automatically. The examiner decides what to do with a flagged paper.
- A small pool gives little variation; the publish check warns about it.
