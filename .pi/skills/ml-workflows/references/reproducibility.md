# Reproducibility Best Practices

## Random Seeds

Always set these seeds before any stochastic operation:

```python
import random
import numpy as np
import torch

SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)
```

For TensorFlow:

```python
import tensorflow as tf
tf.random.set_seed(42)
```

## Data Splits

Use explicit, reproducible data splits:

- **Train**: 60-80% of data
- **Validation**: 10-20% of data
- **Test**: 10-20% of data (ONLY used for final evaluation)

Save the split indices or a hash of the data to verify consistency.

## Environment Locking

- Record Python version, CUDA version, and all package versions
- Use `requirements.txt` or `environment.yml` with pinned versions
- Log the output of `pip freeze` alongside results
