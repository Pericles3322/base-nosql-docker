#!/usr/bin/env python3
"""Mede apenas corridas_carga. Requer Docker Compose e preserva o índice criado ao final."""
import json
import os
import subprocess
import tempfile
from pathlib import Path

destino = os.getenv('CP3_MEDICOES_DIR')
pasta = Path(destino) if destino else Path(tempfile.mkdtemp(prefix='borala-cp3-medicoes-'))
pasta.mkdir(parents=True, exist_ok=True)

def executar(nome, *args):
    raw = subprocess.check_output(['docker','compose','exec','-T','app','npm','run',*args],text=True)
    resultado = json.loads(raw[raw.index('{'):])
    (pasta/(nome+'.json')).write_text(json.dumps(resultado, ensure_ascii=False, indent=2)+'\n')
    print(nome+':', json.dumps(resultado, ensure_ascii=False), flush=True)
    return resultado

carga = executar('carga','seed:carga')
assert carga['total'] >= 30000, 'Carga insuficiente; confira corridas_carga antes da medição.'
try:
    antes = executar('explain-sem-indice','indice:carga','--','remover')
    bench_antes = executar('benchmark-sem-indice','benchmark')
finally:
    # Mesmo que a medição falhe, deixa o índice auxiliar criado.
    depois = executar('explain-com-indice','indice:carga','--','criar')
bench_depois = executar('benchmark-com-indice','benchmark')
assert antes['passageiro_teste_id'] == depois['passageiro_teste_id'] == bench_antes['passageiro_teste_id'] == bench_depois['passageiro_teste_id']
assert antes['nReturned'] == depois['nReturned'] == 10
assert bench_antes['requisicoes'] == bench_depois['requisicoes'] == 1000
assert bench_antes['concorrencia'] == bench_depois['concorrencia'] == 10
assert bench_antes['valido'] and bench_depois['valido']
print('Medições salvas em',pasta,flush=True)
