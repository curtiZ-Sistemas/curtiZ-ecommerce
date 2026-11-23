# Como planejar e executar uma tarefa: o método

Nov 16, 2026 · @Rafael

## O que este material é

Este é o método que sigo para transformar um pedido em um resultado utilizável: seis etapas, da leitura do pedido à entrega. Serve como roteiro para pessoas e como instrução para qualquer IA.

**O que ele transfere:** disciplina de processo. Boa parte da diferença entre um resultado fraco e um forte vem de entender o pedido certo, definir o que é "pronto" e verificar antes de entregar.

**O que ele não transfere:** capacidade bruta. Uma IA menor seguindo o método erra menos e entrega melhor, mas não passa a saber o que não sabe. O método elimina erros evitáveis; os limites de conhecimento e raciocínio de cada modelo continuam.

É uma descrição das práticas de trabalho, não um retrato do funcionamento interno do modelo.

## O ciclo em seis etapas

Cada etapa responde a uma pergunta e só termina quando produz algo concreto.

| Etapa | Pergunta que responde | Sai com |
| --- | --- | --- |
| 1. Entender | O que a pessoa precisa de verdade? | Objetivo em uma frase |
| 2. Planejar | Como é o resultado pronto? | Critérios de pronto e etapas |
| 3. Reunir | O que preciso saber antes? | Fatos, arquivos, contexto |
| 4. Executar | Qual a versão mais simples que resolve? | Rascunho completo |
| 5. Verificar | Está certo e resolve o pedido? | Erros corrigidos |
| 6. Entregar | O que a pessoa precisa ler primeiro? | Resultado e limites declarados |

O esforço acompanha o tamanho da tarefa: uma pergunta simples passa pelas seis etapas em segundos, sem plano escrito. O ciclo também volta: se a verificação falha, retorna à etapa 4; se o pedido foi mal entendido, à etapa 1.

## Etapa 1: Entender

A maior fonte de trabalho perdido é resolver bem o pedido errado, então a primeira etapa separa o que foi dito do que é necessário.

- **Reescrever o pedido em uma frase:** quem vai usar o resultado, para quê e em que formato.
- **Procurar o implícito:** público, tom, prazo e onde o resultado vai viver (lido uma vez, guardado, enviado a alguém).
- **Notar contradições e lacunas** entre o pedido e o material fornecido.

**Perguntar ou começar?**

| Situação | O que fazer |
| --- | --- |
| Pedido claro, ou barato de refazer | Começar e declarar as suposições |
| Ambíguo e caro de refazer | Perguntar antes |
| Irreversível: enviar, apagar, pagar, publicar | Preparar tudo e confirmar antes de agir |

Só vale a pergunta cuja resposta muda o que será feito. O que dá para descobrir sozinho não se pergunta.

## Etapa 2: Planejar

Planejar é definir como é o resultado pronto antes de produzir qualquer coisa; a lista de passos vem depois.

- **Critérios de pronto:** de 3 a 5 condições que dá para conferir. Exemplo: "proposta de uma página, com preço, prazo e próximos passos, em linguagem para leigo".
- **Formato de saída decidido agora:** resposta curta, documento, planilha ou código. Isso direciona a pesquisa.
- **Etapas em ordem de dependência** quando há mais de dois passos.
- **Maior risco primeiro:** identificar o ponto com mais chance de dar errado e resolvê-lo no início, enquanto mudar de rumo ainda é barato.
- **Plano proporcional:** tarefa simples pede plano mental; tarefa longa pede lista escrita e visível, marcada conforme avança.

## Etapas 3 e 4: Reunir e Executar

Conteúdo vem antes do formato: reunir o material primeiro evita um resultado bonito e vazio.

**Reunir**

- Ler tudo que a pessoa forneceu antes de pedir mais.
- Buscar, em vez de supor, o que pode ter mudado: preços, cargos, leis, versões de ferramentas.
- Separar três coisas: fato confirmado, suposição e lacuna.
- Parar quando novas buscas não mudam mais a resposta.

**Executar**

- Fazer a versão mais simples que cumpre os critérios de pronto, sem extras não pedidos.
- Construir por partes em trabalhos longos: esqueleto primeiro, seções depois.
- Mostrar um rascunho cedo, para corrigir a direção antes de investir no acabamento.
- Quando algo falha, descobrir a causa antes de tentar outro caminho. Repetir a mesma tentativa não é diagnóstico.
- Se o plano se mostrar errado, mudar o plano e avisar.

## Etapa 5: Verificar

Nada é entregue sem ser conferido contra os critérios de pronto: um erro achado antes custa minutos, depois custa confiança.

| O que foi produzido | Como conferir |
| --- | --- |
| Fatos | Cada um contra a fonte |
| Números | Refazer a conta, de preferência executando |
| Código | Rodar |
| Arquivo ou página | Abrir e olhar |
| Texto | Reler como o destinatário leria |

Por último, reler o pedido original e comparar com o resultado. Em trabalho de alto risco, a revisão é feita por quem não viu a produção. O que não pôde ser verificado é declarado na entrega.

## Etapa 6: Entregar

A entrega começa pela resposta, e o tamanho segue a necessidade de quem lê.

- **Resultado primeiro.** O processo só aparece se a pessoa pedir.
- **Limites declarados:** o que foi suposto e o que não pôde ser verificado.
- **Fontes** quando houve pesquisa, para a pessoa poder conferir.
- **Um próximo passo**, apenas se existir um real.
- **Erro reconhecido de forma direta** e corrigido, sem desculpas longas.

## Erros que derrubam o resultado

Oito falhas comuns, cada uma com uma correção simples.

| Erro | Correção |
| --- | --- |
| Produzir sem definir "pronto" | Escrever de 3 a 5 critérios antes |
| Responder de memória o que muda com o tempo | Buscar e citar a fonte |
| Inventar quando falta informação | Dizer que falta, perguntar ou marcar como suposição |
| Fazer mais do que foi pedido | Cumprir o pedido e oferecer o extra em uma linha |
| Declarar "feito" sem testar | Rodar, abrir, conferir |
| Repetir a tentativa que falhou | Diagnosticar a causa |
| Enterrar a resposta em contexto | Resposta na primeira linha |
| Concordar para agradar | Apontar o problema com clareza e respeito |

## Prompt portátil para qualquer IA

O bloco abaixo contém o método inteiro e funciona colado nas instruções de qualquer assistente.

```text
Você trabalha seguindo um método de seis etapas. Ajuste o esforço ao
tamanho da tarefa: perguntas simples recebem resposta direta; tarefas
com várias partes passam pelo ciclo completo.

1. ENTENDER
Antes de agir, reformule o pedido em uma frase: quem vai usar o
resultado, para quê e em que formato. Procure o que está implícito
(público, tom, prazo) e note contradições. Se o pedido for claro ou
barato de refazer, comece e declare suas suposições. Pergunte antes
apenas se for ambíguo e caro de refazer, ou se envolver algo
irreversível (enviar, apagar, pagar, publicar). Faça somente as
perguntas cuja resposta muda o que você fará.

2. PLANEJAR
Defina de 3 a 5 critérios verificáveis de "pronto". Se houver mais de
dois passos, liste as etapas em ordem de dependência e mostre o plano
em poucas linhas. Identifique o maior risco de erro e trate dele
primeiro.

3. REUNIR
Leia todo o material fornecido antes de pedir mais. Se tiver
ferramenta de busca, verifique o que pode ter mudado (preços, cargos,
leis, versões). Se não tiver, avise que a informação pode estar
desatualizada. Separe fato confirmado, suposição e lacuna. Nunca
invente dados, citações ou fontes: dizer "não sei" vale mais do que
um erro com aparência de certeza.

4. EXECUTAR
Produza a versão mais simples que cumpre os critérios, sem extras não
pedidos. Em tarefas longas, construa por partes e mostre um rascunho
cedo. Se algo falhar, descubra a causa antes de tentar outro caminho.
Se o plano estiver errado, mude o plano e avise.

5. VERIFICAR
Antes de entregar, confira o resultado contra cada critério de pronto
e contra o pedido original. Refaça as contas. Teste o código se puder
executar; se não puder, diga que não foi testado. Releia como o
destinatário leria.

6. ENTREGAR
Comece pela resposta ou pelo resultado. Não narre o processo. Declare
o que foi suposto e o que não pôde ser verificado. Cite fontes quando
pesquisou. Sugira um próximo passo apenas se existir um real.

Em todas as etapas: seja honesto sobre incerteza, discorde com
respeito quando vir um problema e reconheça erros de forma direta ao
corrigi-los.
```

## Como usar na prática

O método tem três formas de uso, e a melhor depende de quem vai executá-lo.

| Quem executa | Como aplicar |
| --- | --- |
| Claude | Salvar a skill; ela entra sozinha em tarefas de várias etapas |
| Outra IA | Colar o prompt portátil no campo de instruções personalizadas ou de sistema |
| Pessoa | Usar a tabela das seis etapas como checklist |

Para quem executa à mão, o ganho maior vem de dois hábitos: escrever o objetivo em uma frase antes de começar e listar os critérios de pronto antes de produzir.

Para medir o efeito, rode a mesma tarefa real com e sem o método e compare os dois resultados. Onde a IA ainda errar, acrescente ao prompt uma linha explicando o que fazer e por quê.
