# Metric Definitions & Validation

## Classification

| Metric | When to Use | Interpretation |
|--------|-------------|----------------|
| Accuracy | Balanced classes | Correct / total predictions |
| Precision | When false positives are costly | TP / (TP + FP) |
| Recall | When false negatives are costly | TP / (TP + FN) |
| F1-Score | When both precision and recall matter | 2 * (P * R) / (P + R) |
| AUC-ROC | Binary classification, imbalanced | Area under ROC curve |

## Regression

| Metric | When to Use | Interpretation |
|--------|-------------|----------------|
| MSE | When large errors are disproportionately bad | Mean squared error |
| MAE | Interpretable error magnitude | Mean absolute error |
| R² | Variance explained by model | Coefficient of determination |

## Validation Pattern

Always compare against a baseline or the task specification:

```python
def validate_metrics(metrics: dict, threshold: float) -> bool:
    """Check if metrics meet the task requirements."""
    if metrics.get("accuracy", 0) < threshold:
        return False
    if metrics.get("loss", float("inf")) > 1.0:
        return False
    return True
```
