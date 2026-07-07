---
name: bio-design
description: >
  Computational biology guardrails: stable API retrieval from biological
  databases, biological validity constraints (amino acid / DNA alphabets),
  synthesis constraints (GC content, repeats), and data provenance.
  Use for protein design, DNA/RNA analysis, molecular dynamics.
---

# Bio-Design

**Leading word:** _alphabet_ — every biological sequence belongs to a constrained alphabet. Validate against it before any operation.

## Rules

1. **API stability** — Biological databases (UniProt, PDB, NCBI) rate-limit and timeout. Handle retries with backoff, connection timeouts, and graceful degradation.
2. **Alphabet validation** — Every sequence must be validated against its biological alphabet before processing:
   - Amino acids: standard 20-letter code only
   - DNA: `A/T/G/C` only
   - RNA: `A/U/G/C` only
3. **Synthesis constraints** — For sequences destined for synthesis, check GC content (30–70% for DNA), homopolymer repeats (≤6 identical bases), and secondary structure.
4. **Provenance** — Record source and version of every reference database used.

## Setup

```bash
pip install biopython requests
```

Detailed constraints: see [`references/synthesis-constraints.md`](references/synthesis-constraints.md)

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
  provenanceLog: object     // Database sources and versions

PRECONDITIONS:
  - API rate limits respected for external databases
  - Biological alphabet constraints checked (20aa / ATGC)
  - Sequence length within synthesis constraints

POSTCONDITIONS:
  - Sequence uses only standard biological alphabet
  - GC content within 30–70% for synthetic DNA
  - No homopolymer repeats >6 identical bases
  - All data sources recorded with version

ERROR_HANDLING:
  - API rate limited → exponential backoff with jitter
  - Invalid characters → reject with character-level details
  - GC content out of bounds → flag for synthesis review
```
