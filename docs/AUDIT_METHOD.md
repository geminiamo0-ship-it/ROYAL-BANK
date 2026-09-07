# Audit Method

Prioritize correctness/security before performance. Findings are classified by impact, verified against intended business rules, then fixed on an isolated branch. WIP UI is not treated as broken merely for being mock. Refactors may be substantial internally but must preserve intended behavior and current visual design. Dead code is deleted only after proving it unused.
