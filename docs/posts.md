# Posts da comunidade

## Criar post

`POST /v1/comunidade/posts/criar` exige o Bearer token do usuário. Para enviar
arquivos, use `multipart/form-data` com estes campos:

| Campo | Valor |
| --- | --- |
| `conteudo[texto]` | Texto opcional do post |
| `conteudo[foto]` | Arquivo JPG, PNG ou WebP; pode repetir o campo |
| `conteudo[midia]` | Arquivo MP4; pode repetir o campo |

O post aceita até 10 fotos e vídeos no total, com até 25 MB por arquivo. Também
é possível enviar JSON com `conteudo` como uma lista de itens
`{ "tipo": "foto", "valor": "https://..." }` ou
`{ "tipo": "video", "valor": "https://..." }`; essas URLs HTTPS são
importadas para o Cloudinary. Arquivos recebidos por multipart são enviados
ao Cloudinary também. A tabela guarda o texto e a URL segura retornada pelo
Cloudinary dentro da coluna `conteudo` (JSON serializado em `TEXT`), não os
bytes dos arquivos.

## Resposta e leitura

A criação e as rotas de leitura (`GET /feed`, `GET /buscar/:id_post`,
`GET /buscar/post/:id_usuario` e `GET /salvos/:id_usuario`) retornam o campo
`conteudo` como lista normalizada:

```json
[
  { "tipo": "texto", "valor": "Meu post" },
  { "tipo": "foto", "valor": "https://res.cloudinary.com/..." },
  { "tipo": "video", "valor": "https://res.cloudinary.com/..." }
]
```

O front deve percorrer a lista e renderizar `foto` como imagem, `video` como
vídeo e `texto` como texto. As URLs já são as URLs públicas seguras do
Cloudinary. O mesmo formato é usado para posts novos e para os formatos antigos
que o backend ainda reconhece.
