# Guia do Photo Vault

O Photo Vault guarda as suas fotografias e vídeos como ficheiros normais numa pasta que escolhe, no seu próprio computador. Nada é enviado para lado nenhum. Este guia explica o que precisa de saber para os manter em segurança.

## A sua biblioteca

A **biblioteca** é uma pasta com tudo: as fotografias e vídeos (em `originals`, por ano e mês), o catálogo com os seus álbuns, pessoas e datas, e cópias desse catálogo. Ponha-a num disco com bastante espaço. As fotografias são copiadas para lá, nunca movidas, e os ficheiros nunca são alterados.

Pode abrir a pasta no Explorador do Windows a qualquer momento e encontrar lá todas as fotografias. Ao lado de cada uma há um pequeno ficheiro `.xmp` com a data, o local, as etiquetas, os álbuns e as pessoas, que outros programas de fotografia conseguem ler.

## Importar fotografias

Clique em **Importar** no fundo da barra lateral e escolha onde estão as fotografias:

- **Pasta…** para fotografias num disco, num cartão de memória ou numa cópia de segurança de um telemóvel.
- **Arquivos ZIP…** para o Google Takeout ou qualquer outro ZIP. Selecione todas as partes de uma vez.
- **Telemóvel ou câmara…** para um telemóvel ou câmara ligado por USB. Só as fotografias novas são copiadas.

Primeiro, o Photo Vault vê tudo **sem copiar nada**. Depois mostra o que encontrou: quantos itens são novos, quantos já tem e quantos se repetem dentro da importação. Clique em **Importar** para copiar os novos. As pastas e os ficheiros ZIP de onde importa nunca são alterados nem apagados.

Uma fotografia que já tem é reconhecida pelo conteúdo, seja qual for o nome, por isso importar as mesmas coisas duas vezes é seguro: nada é copiado duas vezes. As datas, locais, descrições, favoritos e álbuns do Google Takeout também são lidos.

Para importar fotografias novas automaticamente, adicione uma **pasta vigiada** em **Importar → Importações anteriores**.

## Cópias de segurança

A sua biblioteca é a única cópia das suas fotografias até adicionar uma cópia de segurança. Se o disco onde está avariar, for roubado ou se perder num incêndio, tudo o que lá está desaparece. O cartão no fundo da barra lateral mostra se as suas fotografias têm cópia: **Sem cópia de segurança**, **Protegida**, ou quantos itens ainda não têm cópia.

### Configurar um disco de cópia

1. Ligue um disco externo. Deve ser um disco diferente daquele onde está a biblioteca.
2. Clique no cartão de segurança no fundo da barra lateral. Abre a página **Segurança**.
3. Clique em **Adicionar local de cópia** e escolha o disco externo, ou uma pasta dentro dele. Se o disco já tiver outros ficheiros, o Photo Vault cria uma pasta chamada **Photo Vault Backup** e usa essa.
4. A primeira cópia começa logo. Cada fotografia é copiada e depois lida de novo para confirmar que a cópia está perfeita. Uma biblioteca grande demora algumas horas, e pode continuar a usar a aplicação enquanto isso.
5. Quando termina, o cartão na barra lateral diz **Protegida**.

Clique no nome do disco para lhe dar um nome, como "Disco de casa". Deixe ligado **Fazer cópia automaticamente depois de importações**.

### Mantê-la atualizada

Ligue o disco de vez em quando. É atualizado assim que é ligado e recebe só o que é novo. Nada é apagado automaticamente de uma cópia de segurança, nem sequer fotografias que elimine da biblioteca.

Uma vez por mês, o Photo Vault volta a ler todas as fotografias da biblioteca e de qualquer disco de cópia ligado, e compara cada uma com a impressão digital registada na importação. Uma cópia danificada ou em falta num disco de cópia é copiada de novo.

### Um segundo disco fora de casa

Um disco que está ao lado do computador pode perder-se juntamente com ele. Com dois discos, guarde um noutro sítio (no trabalho, ou com a família) e troque-os mais ou menos todos os meses. Adicione cada um com **Adicionar local de cópia**; cada um é atualizado quando é ligado.

### Se perder a biblioteca

Um disco de cópia é uma biblioteca completa. Instale o Photo Vault em qualquer computador, escolha **Abrir uma biblioteca existente** (ou **Definições → Biblioteca → Abrir outra biblioteca…**) e escolha a pasta da cópia. As fotografias, álbuns, pessoas, datas e favoritos estão todos lá. As miniaturas são criadas de novo sozinhas. Depois adicione um novo disco de cópia, porque o disco que abriu passou a ser a sua biblioteca.

### Cópias do catálogo

Os seus álbuns, pessoas, datas e etiquetas vivem no catálogo. O Photo Vault guarda uma cópia dele todos os dias, depois de cada importação, antes de eliminações definitivas e antes de atualizações. Se algo correr mal, por exemplo um álbum apagado por engano, vá a **Segurança → Cópias do catálogo** e clique em **Restaurar** ao lado de uma cópia anterior. O catálogo atual é guardado primeiro, por isso também pode desfazer um restauro. Os ficheiros das fotografias não são tocados.

## Ocultar, o Lixo e eliminar

- **Ocultar** (**Ocultar de Fotografias**) tira os itens só da cronologia de Fotografias. Continuam na biblioteca, nos álbuns, na pesquisa e nas cópias de segurança. Use-o para coisas que quer guardar mas não ver: memes, recibos, autocolantes de conversas. Os itens ocultos estão em **Arrumar → Ocultos**, onde os pode mostrar de novo.
- **Lixo** tira os itens de todas as vistas. Ficam no Lixo, ainda no disco e ainda com cópia, até os restaurar ou eliminar. Nada é eliminado automaticamente.
- **Eliminar definitivamente** (a partir do Lixo) remove os ficheiros da biblioteca. Por omissão vão para a Reciclagem do Windows, por isso ainda os pode recuperar até a esvaziar. As cópias que já estão num disco de cópia são mantidas. Se importar os mesmos ficheiros mais tarde, são ignorados.

Ocultar, mover para o Lixo e os favoritos podem ser desfeitos durante alguns segundos com **Desfazer** na barra em baixo.

## Arrumar e "Provavelmente recebido ou guardado"

**Arrumar** junta o que talvez queira ocultar ou eliminar: fotografias do WhatsApp e de outras aplicações de conversa, capturas de ecrã, transferências, autocolantes, duplicados e séries de fotografias quase iguais.

Cada fotografia é identificada com a origem mais provável, a partir de pistas no ficheiro. **Provavelmente recebido ou guardado** quer dizer que o ficheiro não tem informação da câmara nem data de captura, o que quase sempre significa que veio de outra pessoa, por uma aplicação de conversa ou rede social, ou foi guardado da internet. O Photo Vault não pode ter a certeza, por isso estes ficam agrupados por pistas de tamanho (**Provavelmente WhatsApp**, **Provavelmente redes sociais**) para os rever, e nada é ocultado nem eliminado sem ser escolha sua.

**Prováveis duplicados** são a mesma fotografia guardada mais de uma vez com bytes diferentes (redimensionada ou comprimida). **Fotografias semelhantes** são séries de fotografias tiradas seguidas. Em ambos, a melhor cópia é sugerida e decide o que fazer às outras.

## Mudar para um computador novo

1. Feche o Photo Vault no computador antigo.
2. Copie a pasta da biblioteca inteira para o computador novo, ou para um disco que leve consigo. Copie a pasta toda, não só `originals`. O catálogo em `database` guarda os seus álbuns, pessoas e datas.
3. Instale o Photo Vault no computador novo, escolha **Abrir uma biblioteca existente** e escolha a pasta copiada.
4. Na página **Segurança**, confira os discos de cópia. Se um disco tiver agora outra letra, remova-o e adicione-o de novo com **Adicionar local de cópia**. É reconhecido e só é copiado o que for novo.
5. No computador novo, adicione de novo o token de atualizações em **Definições → Atualizações**, e ligue de novo a pesquisa inteligente e as descrições se as usava. Voltam a transferir os modelos, ou carregam-nos de uma pasta guardada com **Definições → Modelos de IA → Guardar uma cópia numa pasta…**.

Também pode abrir um disco de cópia (ver "Se perder a biblioteca") se o computador antigo não estiver disponível.

## Pesquisa inteligente, descrições e pessoas

Estas funções estão desligadas até as ligar em **Definições**. Funcionam inteiramente neste computador: as suas fotografias nunca são enviadas. Cada uma transfere o seu modelo uma vez e depois trabalha nas fotografias em segundo plano. A pesquisa já funciona nas fotografias que estiverem prontas.

- **Pesquisa inteligente** encontra fotografias pelo que mostram, como "praia ao pôr do sol", "cão" ou "recibo". Escreva na caixa de pesquisa (Ctrl K) e escolha **Fotografias que parecem…**. Também encontra cães e gatos para Pessoas.
- **Descrições automáticas** escrevem uma frase curta sobre cada fotografia, como "A dog sitting in a field". Aparece nos detalhes da fotografia e a caixa de pesquisa encontra-a. Demora cerca de 2 segundos por fotografia, das mais recentes para as mais antigas, por isso uma biblioteca grande leva muitas horas. As descrições são em inglês.
- **Pessoas** agrupa as fotografias pelos rostos. Dê um nome a uma pessoa uma vez e a pesquisa encontra as fotografias dela.

Enquanto trabalham, um cartão na barra lateral mostra o progresso. O **Modo offline** em Definições bloqueia todas as ligações à internet, como garantia. As funções cujos modelos já foram transferidos continuam a funcionar.

## Atualizações

As cópias instaladas atualizam-se sozinhas. Uma versão nova é transferida em segundo plano e instalada quando sai, ou clique em **Reiniciar e atualizar** em **Definições → Atualizações**. O que mudou em cada versão está em **Novidades** neste guia.
