# Synthesis Constraints

## DNA/RNA Sequence Constraints

| Constraint | Typical Limit | Reason |
|------------|---------------|--------|
| GC Content | 40-60% | Extreme GC affects synthesis efficiency |
| Repeat Length | < 8 bp | Long repeats cause recombination issues |
| Hairpins | ΔG > -8 kcal/mol | Strong secondary structures block synthesis |
| Homopolymer runs | < 5 bp | Poly-A/T/G/C tracts are problematic |

## Protein Sequence Constraints

| Constraint | Check | Reason |
|------------|-------|--------|
| Standard amino acids | 20 standard + selenocysteine | Non-standard residues require special codons |
| Signal peptides | Present if targeting secretion | Needed for proper localization |
| Post-translational mods | Glycosylation motifs may affect expression | Consider expression host |

## Validation Checklist

- [ ] Sequence uses standard alphabet
- [ ] GC content within acceptable range
- [ ] No long repeats or homopolymers
- [ ] No strong secondary structures
- [ ] Appropriate for target expression system
