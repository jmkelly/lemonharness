---
name: ml-workflows
description: >
  Best practices for ML/deep learning tasks: training/validation/submission
  artifact separation, reproducibility (random seeds, data splits), metric
  validation against task goals. Use for any ML, DL, or data science task.
---

# ML Workflows

## Key Rules

1. **Artifact separation**: Keep training outputs, validation results, and
   submission artifacts in separate directories.
2. **Reproducibility**: Always set random seeds (torch, numpy, python built-in
   `random`) before training. Record the seed value and data split used.
3. **Metric validation**: Validate final metrics against the task specification.
   Do not assume that a decreasing loss alone indicates task completion.
4. **Data splits**: Use explicit train/val/test splits; do not leak test data
   into training.
5. **Checkpointing**: Save model checkpoints periodically; keep the best
   checkpoint based on validation metrics, not training loss.

## Setup

Run once before first use:

```bash
# No special setup needed; rules are loaded into agent context.
```

## Usage

When the model detects an ML-related task, it should read this skill's
references for detailed guidance on reproducibility and metrics.

See [reproducibility](references/reproducibility.md) for seed and split best practices.
See [metric-definitions](references/metric-definitions.md) for common ML metrics and validation patterns.

---

## Pseudocode

```
SKILL ml-workflows

INPUTS:
  taskType: string          // training, inference, evaluation, deployment
  framework: string         // pytorch, tensorflow, sklearn
  hasGPU: boolean           // Whether GPU acceleration is available
  dataFormat: string        // csv, image, text, hdf5, etc.

OUTPUTS:
  experimentConfig: object
  //   seed: number
  //   train_path: string
  //   val_path: string
  //   test_path: string
  trainingArtifact: object  // checkpoint path, metrics, final model

PRECONDITIONS:
  - Random seed (torch, numpy, random) set before training
  - Data splits are disjoint with no leakage
  - Test data is held out until final evaluation

POSTCONDITIONS:
  - Training/validation/submission artifacts in separate directories
  - Best checkpoint saved based on validation metrics
  - Final metrics validated against task specification
  - Seed and data split recorded in reproducibility log

ERROR_HANDLING:
  - If GPU requested but unavailable -> fall back to CPU with warning
  - If data split leakage detected -> abort and re-split
  - If validation metric diverges from expected -> log anomaly
```
