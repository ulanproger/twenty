# OIDC SSO: рецепты для провайдеров

Важно: модуль проверен только на тестовом IdP (`mock-oauth2-server`). Ни один из провайдеров ниже не тестировался вживую. Пункты, помеченные «сверено с документацией», сверены с официальными страницами вендора, остальное проверьте по документации вашего IdP.

## Чек-лист совместимости

Любой IdP должен соответствовать всем пунктам, иначе провайдер не создастся или вход будет отклонён:

1. Публикует `/.well-known/openid-configuration` по адресу `<issuer>/.well-known/openid-configuration`, а поле `issuer` в нём совпадает с введённым Issuer. Конечная `/` не важна, она отбрасывается с обеих сторон.
2. В discovery есть `authorization_endpoint`, `token_endpoint` и `jwks_uri`. Если IdP заявляет `code_challenge_methods_supported`, в списке должен быть `S256`; если поле отсутствует, проверка пропускается, но IdP всё равно обязан принимать PKCE S256.
3. Подписывает id_token асимметрично (RS256 по умолчанию, иначе первый из `RS*`, `PS*`, `ES*`, `EdDSA`, что заявлен IdP).
4. Возвращает в id_token `email` и `email_verified=true` (булево значение или строка `true`) для запрошенных scope `openid email profile`.
5. Принимает аутентификацию клиента через `client_secret_basic` или `client_secret_post`.
6. Доступен серверу Twenty по сети. Адреса во внутренних сетях по умолчанию заблокированы, см. [справочник](reference.md#переменные-окружения).

Issuer не должен содержать `?`, `#`, логин и пароль.

## Google

Сверено с документацией.

- Issuer: `https://accounts.google.com`.
- `email_verified` возвращается вместе со scope `email`. PKCE S256 заявлен в discovery.
- В Google Cloud Console создайте OAuth client типа Web application. Redirect URI из диалога Twenty добавьте в Authorized redirect URIs клиента (Clients, ваш клиент).
- Вход ограничен вашей организацией только настройками Google (тип пользователей приложения), модуль Twenty домен не фильтрует.

## Okta

Частично сверено с документацией.

- Issuer: адрес Org-сервера `https://<ваш-домен>.okta.com` или адрес Custom Authorization Server `https://<ваш-домен>.okta.com/oauth2/<id>` (часто `default`). Выберите тот, чей discovery у вас работает.
- `email_verified` возвращается вместе со scope `email`, значение `true`, когда основной email подтверждён.
- Приложение: OIDC, Web Application, Grant type Authorization Code. Redirect URI из диалога Twenty добавьте в Sign-in redirect URIs.

## Keycloak

Не сверено с документацией, проверьте.

- Issuer: `https://<хост>/realms/<realm>`. В старых версиях перед `realms` есть `/auth`.
- Клиент: Client authentication включена (confidential), Standard flow включён. Redirect URI из диалога Twenty добавьте в Valid redirect URIs.
- PKCE: проверьте, что метод S256 разрешён для клиента.
- Убедитесь, что email пользователя подтверждён: Keycloak ставит `email_verified` по этому полю.

## Auth0

Не сверено с документацией, проверьте.

- Issuer: `https://<tenant>.auth0.com` (в discovery он обычно с `/` на конце, это допустимо).
- Приложение: Regular Web Application. Redirect URI из диалога Twenty добавьте в Allowed Callback URLs.
- Email пользователя должен быть подтверждён, иначе `email_verified` будет `false`.

## Authentik

Не сверено с документацией, проверьте.

- Создайте провайдер типа OAuth2/OpenID с Client type Confidential и привяжите к приложению. Issuer и discovery берутся со страницы приложения (адрес вида `https://<хост>/application/o/<slug>/`).
- Redirect URI из диалога Twenty добавьте в Redirect URIs провайдера.
- Проверьте, что scope `email` включён и отдаёт `email_verified`.

## Microsoft Entra ID

Не поддерживается. В id_token Entra нет стандартного `email_verified` (в документации есть только необязательный `xms_edov` для проверки домена владельца), а Twenty требует именно `email_verified=true`. Поле `upn` не читается намеренно. Варианты: поставить между Twenty и Entra IdP-посредник (например Keycloak или Authentik с подключением Entra как внешнего источника входа), который сам выдаёт `email_verified`, либо использовать для воркспейса другой IdP. Работоспособность такой цепочки не проверялась.
