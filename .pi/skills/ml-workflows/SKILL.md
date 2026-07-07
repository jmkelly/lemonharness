---
name: ml-workflows
description: >
  ML reproducibility and artifact discipline: train/val/test separation,
  random seed recording, metric validation against task goals, checkpoint
  management. Use for any ML, DL, or data science task.
---

# ML Workflows

**Leading word:** _leakage_ — the cardinal sin in ML is information leaking across the train/val/test boundary. Every rule below serves to prevent it.

## Rules

1. **Artifact separation** — Training outputs, validation results, and submission artifacts live in separate directories. Never mix them.
2. **Reproducibility** — Set random seeds (`torch`, `numpy`, `random`) before every training run. Record the seed value and the exact data split used.
3. **Metric validation** — Validate final metrics against the task specification. A decreasing loss curve alone does not mean the task is done — check the actual evaluation metric.
4. **Data splits** — Explicit, disjoint train/val/test splits. Test data never touches training — not for normalization, not for feature engineering.
5. **Checkpointing** — Save model checkpoints periodically. Keep the best checkpoint based on **validation** metrics, never training loss.

## Setup

Detailed reproducibility and metrics guidance:
- [Reproducibility](references/reproducibility.md) — seed and split best practices
- [Metric definitions](references/metric-definitions.md) — common ML metrics and validation patterns

---

## Pseudocode

```
SKILL ml-workflows

INPUTS:
  taskType: string          // training, inference, evaluation
  framework: string         // pytorch, tensorflow, sklearn
  hasGPU: boolean           // GPU acceleration available
  dataFormat: string        // csv, image, text, hdf5, etc.

OUTPUTS:
  experimentConfig: object
  //   seed: number
  //   train_path: string
  //   val_path: string
  //   test_path: string
  trainingArtifact: object  // checkpoint path, metrics, final model

PRECONDITIONS:
  - Random seed set before training (torch, numpy, random)
  - Data splits disjoint with no leakage
  - Test data held out until final evaluation

POSTCONDITIONS:
  - Training/validation/submission artifacts in separate directories
  - Best checkpoint saved based on validation metrics
  - Final metrics validated against task specification
  - Seed and data split recorded in reproducibility log

ERROR_HANDLING:
  - GPU requested but unavailable → fall back to CPU with warning
  - Data split leakage detected → abort and re-split
  - Validation metric diverges from expected → log anomaly
```
