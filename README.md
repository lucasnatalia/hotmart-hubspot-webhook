# Hotmart → HubSpot Webhook (Vercel)

Este projeto recebe **webhooks da Hotmart** e cria/atualiza **Contatos no HubSpot** automaticamente. Pronto para publicar na **Vercel**.

## ✨ O que faz
- Recebe POST em **`/hotmart`** com dados da Hotmart
- Extrai **email, status, produto**
- Faz **upsert** no HubSpot (via `idProperty=email`)
- Preenche propriedades: `origem_hotmart`, `produto_hotmart`, `status_hotmart`, e `lifecyclestage=customer`
- (Opcional) Atribui o contato a um **owner** do HubSpot via `OWNER_EMAIL`

## 🚀 Publicar na Vercel
1. Crie conta em https://vercel.com e crie um **novo projeto** (Importe este repositório ou arraste os arquivos).
2. Antes de deploy, configure **Environment Variables** no projeto:
   - `HUBSPOT_TOKEN` → Token do Private App do HubSpot (não compartilhe publicamente)
   - `HOTMART_SECRET` → Chave secreta que você vai repetir na Hotmart (ex.: `minhasenha123`)
   - `OWNER_EMAIL` → (opcional) Email do proprietário do contato no HubSpot
3. Faça o **Deploy**. A Vercel vai gerar uma URL como `https://SEU-PROJ.vercel.app`.

## 🔗 Configurar Hotmart
No painel da Hotmart → **Ferramentas → Notificações/Webhooks → Criar**:
- **URL de notificação**: `https://SEU-PROJ.vercel.app/hotmart`
- **Método**: `POST`
- **Eventos**: marque pelo menos **Compra aprovada** (adicione Reembolso/Chargeback se desejar atualizar o status)
- **Formato**: JSON (se houver opção)
- **Chave secreta**: mesma de `HOTMART_SECRET` nas variáveis da Vercel

## ✅ HubSpot – Propriedades
Crie as propriedades no objeto **Contato** (ou use já existentes se criou antes):
- `origem_hotmart` → Texto (linha única)
- `produto_hotmart` → Texto (linha única)
- `status_hotmart` → Dropdown (approved, refunded, chargeback, pending)

Crie uma **Lista Ativa** com filtros, por exemplo:
- `origem_hotmart` = `hotmart`
- `status_hotmart` = `approved`

## 🔐 Permissões (scopes) no HubSpot Private App
- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- `crm.schemas.contacts.read`
- `crm.schemas.contacts.write`
- (Opcional p/ owner): `settings.users.read`

## 🧪 Teste rápido
- Na Hotmart, use **Teste de Notificação** ou faça uma venda real/sandbox.
- Verifique no HubSpot se o contato foi criado/atualizado e caiu na lista ativa.

## 📝 Observações
- Este endpoint aceita tanto `application/json` quanto `x-www-form-urlencoded`.
- Idempotência simples por `event_id` (se presente) para evitar duplicados.
- Em caso de erro, retornamos `200` para reduzir reenvios agressivos da Hotmart e logamos o problema.

## ⚠️ Segurança
- **Nunca** versionar ou expor seu `HUBSPOT_TOKEN`.
- Utilize `HOTMART_SECRET` e valide-o no header `x-hotmart-secret` (ou `x-hotmart-signature`).
