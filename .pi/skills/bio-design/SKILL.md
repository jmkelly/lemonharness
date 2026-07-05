---
name: bio-design
description: >
  Rules for bio-design and computational biology tasks: stable API data
  retrieval, biological validity constraints, and synthesis constraints.
  Use for protein design, DNA/RNA analysis, molecular dynamics, or
  any computational biology task.
---

# Bio-design

## Key Rules

1. **API stability**: When querying biological databases (UniProt, PDB, NCBI),
   handle rate limiting, retries, and connection timeouts gracefully.
2. **Biological validity**: Validate outputs against known biological
   constraints (e.g., amino acid sequences must use standard 20-letter code,
   DNA sequences must contain only A/T/G/C).
3. **Synthesis constraints**: If designing sequences for synthesis, check
   for GC content, repeats, and secondary structure issues.
4. **Data provenance**: Record the source and version of all biological
   reference data used.

## Setup

```bash
# Install common bioinformatics libraries as needed:
pip install biopython requests
```

## Usage

See [synthesis-constraints](references/synthesis-constraints.md) for
detailed constraints on sequence design for synthesis.

---

## Pseudocode

```
SKILL bio-design

INPUTS:
  moleculeType: string      // protein, dna, rna, small_molecule
  sourceDatabase: string    // uniprot, pdb, ncbi, custom
  designGoal: string        // synthesis, analysis, prediction
  sequence?: string         // Optional input sequence

OUTPUTS:
  validatedSequence: string // Biologically validated sequence
  provenanceLog: object     // // Database sources and versions
  //   database: string
  //   version: string
  //   accession: string

PRECONDITIONS:
  - API rate limits must be respected for external databases
  - Biological alphabet constraints must be checked (20aa / ATGC)
  - Sequence length must be within synthesis constraints

POSTCONDITIONS:
  - Sequence uses only standard biological alphabet
  - GC content within 30-70% for synthetic DNA
  - No long homopolymer repeats (>6 identical bases for DNA)
  - All data sources recorded with version

ERROR_HANDLING:
  - If API rate limited -> exponential backoff with jitter
  - If sequence contains invalid characters -> reject with details
  - If GC content outside bounds -> flag for synthesis review
```
