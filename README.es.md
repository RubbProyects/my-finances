[English](README.md) · **Español**

# Mi cartera (My Finances)

App web personal, pensada para el móvil, para seguir **todo tu dinero en un solo sitio**: cuentas, inversiones, gastos, rentabilidad, fiscalidad y proyección a futuro. Los movimientos del banco llegan solos gracias a la normativa europea de *open banking* (PSD2).

Hecha con **Next.js + Supabase + Vercel**, todo en **planes gratuitos**. La app es bilingüe (español e inglés), con selector de idioma.

> Proyecto personal hecho mientras aprendo a programar. No es asesoramiento financiero: los cálculos fiscales y las proyecciones son **orientativos**.

## Qué hace

**📊 Resumen**
- Patrimonio total, saldo de cada cuenta y valor de las inversiones.
- Aviso cuando el permiso del banco está a punto de caducar.

**📈 Inversiones**
- Compras, ventas, dividendos y *splits* (las participaciones se recalculan solas).
- **Comisión calculada sola** a partir de las tarifas de cada plataforma.
- **Traspasos entre fondos** (venta y compra enlazadas, sin tributar).
- **Precios automáticos** cada día: Yahoo Finance para ETF, acciones y crypto, y Financial Times para fondos (por ISIN).
- Cuánto ha subido o bajado cada activo en su último día.

**💸 Movimientos**
- Gastos, ingresos, transferencias y ajustes, con categorías, Bizum y **reembolsos** (un Bizum que te devuelve parte de una cena resta de ese gasto).
- **Conexión con el banco** (solo lectura) mediante Enable Banking: los movimientos llegan a una bandeja «Por clasificar».
- **Reglas:** lo que se repite (el súper, el gimnasio…) **se apunta solo** cada noche.
- Detección de **repetidos**, la otra parte de las transferencias entre tus cuentas y **comparación con el saldo del banco**.

**🔍 Análisis**
- **Reparto** del capital por tipo, plataforma, categoría o activo.
- **Rentabilidad** por periodos (de 1 día a «todo»), con el método Modified Dietz para que una compra nueva no cuente como ganancia.
- **🧾 Fiscal:** ganancias y pérdidas por año con **FIFO**, traspasos que conservan el coste, aviso de la regla de los 2 meses y dividendos.
- **💸 Gastos:** gastos reales, balance por categoría, últimos 12 meses y Bizum frente al resto.
- **🔮 Proyección** de tu cartera con interés compuesto y aportaciones mensuales.
- **🧮 Simulador** desde cero: varios activos a la vez, aportación inicial y aportaciones semanales, mensuales o anuales.

**⚙️ Ajustes**
- Activos, plataformas, tipos, categorías, tarifas, bancos e idioma.

**Y además**
- Botón **👁️/🙈 para difuminar el dinero** (para enseñar la app sin enseñar cifras).
- **Instalable en el móvil** como una app.
- **Copia de seguridad semanal** de los datos y de la estructura de la base de datos, con restauración probada (en un repositorio privado aparte).

## Cómo funciona por dentro

```
Móvil / navegador ──► Vercel (Next.js) ──► Supabase (PostgreSQL + login)
                          │
                          ├─► Yahoo Finance y Financial Times (precios)
                          └─► Enable Banking ──► tu banco (PSD2, solo lectura)

Cron diario de Vercel (21:00 UTC): precios ➜ movimientos del banco ➜ apuntar con reglas
GitHub Actions semanal (opcional): copia de seguridad ➜ repositorio privado
```

- **Los datos se piden desde el navegador** directamente a Supabase con la clave pública. La seguridad la ponen las reglas de la base de datos (**RLS**): cada fila tiene dueño (`user_id`) y cada usuario solo ve lo suyo.
- **Las rutas del servidor** (`app/api/…`) usan la clave secreta de Supabase. Solo existen para lo que no puede hacer el navegador: pedir precios, hablar con el banco y el cron.
- **El saldo de las cuentas no se guarda: se calcula** a partir de los movimientos (vista `account_balances`). Para corregirlo se crea un movimiento de tipo «ajuste».
- **Login con correo y contraseña y registro desactivado:** solo entra quien tenga un usuario creado a mano en Supabase.
- **Los cálculos** (rentabilidad, fiscal, gastos, proyección, banco…) son funciones puras en `lib/*.ts`, separadas de la pantalla (`components/*.tsx`).
- Sin librerías de gráficas: las gráficas están hechas a mano en SVG.
- **Modo demo** (`NEXT_PUBLIC_DEMO=1`, ver `lib/demo.ts`): el mismo código publicado otra vez, con su propio Supabase y datos de mentira de `supabase/demo.sql`. Añade un botón «Try the demo», empieza en inglés, no tiene conexión real con el banco y el cron de cada noche vuelve a poner los datos de mentira.

| Carpeta | Qué hay |
| --- | --- |
| `app/` | Página, icono, manifest y rutas del servidor (`app/api/prices`, `cron`, `bank/…`) |
| `components/` | Cada pantalla y desplegable (Resumen, Inversiones, Movimientos, Análisis, Ajustes…) |
| `lib/` | Cálculos y conexiones (Supabase, Yahoo, FT, Enable Banking) |
| `supabase/schema.sql` | La estructura completa de la base de datos, para un proyecto nuevo |
| `supabase/demo.sql` | Datos de mentira para la demo pública (solo para el proyecto de la demo) |
| `vercel.json` | El cron diario |

## Tenerla tú: instalación paso a paso

Necesitas unos **60–90 minutos** y cuentas gratuitas en **GitHub**, **Supabase** y **Vercel**. Para conectar tu banco, también en **Enable Banking** (opcional). No hace falta instalar nada: todo se hace desde la web de cada servicio.

> ℹ️ El código es público pero **no es de código abierto** (ver [Licencia](#licencia)). Para instalar tu propia copia, pide permiso antes abriendo un *issue*.

> ⚠️ **Nunca subas a GitHub ni compartas** tus claves secretas ni el archivo `.pem` de Enable Banking. Solo van en Vercel (y en tu `.env.local` si pruebas en tu ordenador, que Git ya ignora).

### 1. Copia el código (GitHub)

1. Crea una cuenta en [github.com](https://github.com) si no tienes.
2. En esta página, pulsa **Fork** → **Create fork**. Ahora tienes tu propia copia del código.

### 2. Crea la base de datos (Supabase)

1. Crea una cuenta en [supabase.com](https://supabase.com) (puedes entrar con GitHub).
2. **New project:**
   - nombre: el que quieras (por ejemplo `mi-cartera`);
   - contraseña de la base de datos: la que genere Supabase (guárdala, aunque la app no la usa);
   - región: una de Europa;
   - plan: **Free**.
3. Cuando esté listo, abre **SQL Editor** → **New query**.
4. Abre el archivo [`supabase/schema.sql`](supabase/schema.sql) de este repositorio, copia **todo** su contenido y pégalo.
5. Pulsa **Run**. Debe terminar sin errores. Si el proyecto ya tenía tablas, el script se para sin tocar nada: solo vale para un proyecto **nuevo y vacío**. Necesita **PostgreSQL 17**, que es lo que usan los proyectos nuevos de Supabase. Si sale `unrecognized privilege type "maintain"`, tu proyecto es de una versión anterior: actualízalo en *Project Settings* → *Infrastructure*, o borra la palabra `maintain,` del script.
6. **Desactiva el registro:** *Authentication* → ajustes de inicio de sesión → apaga **Allow new users to sign up**. Así nadie más puede crearse una cuenta en tu app.
7. **Crea tu usuario:** *Authentication* → *Users* → **Add user** → **Create new user**, con tu correo y tu contraseña y **Auto Confirm User** marcado.
8. Apunta en un sitio seguro (no en GitHub) estos tres datos:
   - **Project URL** (`https://xxxx.supabase.co`), en *Project Settings* → *Data API* o en el botón **Connect**;
   - **Publishable key** (`sb_publishable_…`), en *Project Settings* → *API Keys*;
   - **Secret key:** en *API Keys* → *Secret keys* → **New secret key**. Ponle un nombre con `_` (Supabase no admite `-`), por ejemplo `vercel_app`, y copia el valor `sb_secret_…`. **Es secreta.**

### 3. Publica la app (Vercel)

1. Crea una cuenta en [vercel.com](https://vercel.com) con tu GitHub (plan **Hobby**, gratis, para uso personal).
2. **Add New…** → **Project** → elige tu fork → **Import**.
3. En **Environment Variables**, añade:

| Variable | Valor | Tipo |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Tu Project URL | Normal |
| `NEXT_PUBLIC_SUPABASE_KEY` | Tu Publishable key | Normal |
| `SUPABASE_SECRET_KEY` | Tu Secret key `sb_secret_…` | **Sensitive** |
| `CRON_SECRET` | Una contraseña larga inventada (por ejemplo, 40 letras y números al azar) | **Sensitive** |

4. Pulsa **Deploy**. Al terminar tendrás una dirección del estilo `https://tu-proyecto.vercel.app`. Si quieres cambiarla, hazlo ahora en *Settings* → *Domains*: Enable Banking necesita la dirección definitiva.
5. Abre la dirección y entra con el usuario del paso 2.7.

El **cron diario** se activa solo con `vercel.json` (lo ves en *Settings* → *Cron Jobs*). Cada noche actualiza los precios y, si tienes bancos conectados, trae sus movimientos.

> Cada vez que cambies una variable de entorno: *Deployments* → el último → ⋯ → **Redeploy**.

### 4. Configura la app

Empiezas con todo vacío, salvo los **tipos de activo base** (cuenta bancaria, cuenta remunerada, ETF, fondo de inversión, acción, plan de pensiones…), que la app crea sola. Elige tu idioma en **⚙️ Ajustes** → **🌐 Idioma** y después, por este orden:

1. **🏢 Plataformas:** dónde tienes el dinero (tu banco, tu bróker…).
2. **🧩 Tipos de activo:** revisa el **% anual** de cada tipo (lo usa la proyección) y añade los tuyos si te hacen falta. Cada tipo se valora:
   - **a precio de mercado** (precio × participaciones), como un ETF o un fondo;
   - **por su saldo**, como una cuenta.
3. **💼 Activos:**
   - **cada cuenta** (un activo de un tipo «por saldo» por cada sitio con efectivo);
   - **cada inversión**, con su fuente de precio:
     - **Yahoo**, con el símbolo que cotiza en euros (el buscador te ayuda);
     - **Financial Times** por ISIN, para fondos;
     - **manual**.
4. **💶 Tarifas de comisión** de cada plataforma.
5. **🛒 Categorías de gasto.**
6. **Saldo de hoy** de cada cuenta: crea un movimiento de tipo **ajuste**.
7. **Inversiones que ya tienes:** apúntalas como **compras** con su fecha, importe, participaciones y comisión.

### 5. Conecta tu banco (opcional, Enable Banking)

[Enable Banking](https://enablebanking.com) tiene un modo gratuito (**producción restringida**) para conectar **tus propias cuentas**. Solo puede leer: no puede mover dinero.

1. Crea una cuenta en enablebanking.com.
2. En su panel, registra una aplicación:
   - **Entorno:** Production (restringido);
   - **Nombre:** el que quieras;
   - **Tipo de usuario:** Personal;
   - **Redirect URL:** `https://tu-proyecto.vercel.app/api/bank/callback`, con tu dirección exacta. (`localhost` **no** sirve: se conecta siempre desde la app publicada.)
3. Se descargará un archivo **`.pem`** (tu clave privada). Guárdalo en tu ordenador. **El nombre del archivo, sin `.pem`, es el ID de tu aplicación.**
4. En Vercel, añade dos variables y haz **Redeploy**:

| Variable | Valor | Tipo |
| --- | --- | --- |
| `ENABLE_BANKING_APP_ID` | El nombre del `.pem` sin la extensión | Normal |
| `ENABLE_BANKING_KEY` | El contenido completo del `.pem` (ábrelo con el Bloc de notas: `Ctrl+A`, `Ctrl+C`), con las líneas `BEGIN` y `END`, sin comillas | **Sensitive** |

5. En modo restringido, **cada banco se vincula primero en el panel de Enable Banking** y después se conecta desde la app.
6. En la app: **⚙️ Ajustes** → **🏦 Bancos** → elige país y banco → **Conectar** → autoriza en tu banco → vuelves a la app.
7. **Asigna** cada cuenta del banco a su cuenta de la app.
8. **💸 Movimientos** → **📥 Por clasificar** → **Traer**. La primera vez descarga unos 90 días. Clasifica, crea reglas para lo que se repite y usa **⚖️ Comparar con el saldo del banco** para cuadrar.

Consejos:

- El país debe coincidir con el de tu IBAN.
- Revolut da una cuenta por moneda; la app solo lee las cuentas en euros.
- El permiso del banco dura como mucho 180 días: la app te avisa antes y basta con volver a conectarlo.

### 6. Instálala en el móvil

- **iPhone:** abre tu dirección en **Safari** → botón Compartir → **Añadir a pantalla de inicio**.
- **Android:** **Chrome** → menú ⋮ → **Instalar app**.

### 7. Copia de seguridad (opcional)

La copia semanal funciona con GitHub Actions en un **repositorio privado aparte**, con dos secretos (`SUPABASE_URL` y una `SUPABASE_SECRET_KEY` propia). Guarda cada tabla en JSON y la estructura con la función `public.schema_sql()`, que ya crea `schema.sql`. Los scripts no están en este repositorio porque viven junto a los datos; si te interesan, abre un *issue*.

### 8. Recibir las mejoras

1. Si una versión nueva trae SQL (en `supabase/`), **ejecútalo antes** en tu SQL Editor.
2. En tu fork, pulsa **Sync fork** → **Update branch**. Vercel publica la versión nueva sola.

## Probarla en tu ordenador (para tocar el código)

Requisitos: **Git**, **Node.js 22** y un editor (VS Code).

```bash
git clone https://github.com/<tu-usuario>/my-finances.git
cd my-finances
npm ci
```

Crea un archivo `.env.local` en la raíz con las mismas variables que en Vercel. La clave de Enable Banking, entre comillas dobles y en varias líneas:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
CRON_SECRET=...
ENABLE_BANKING_APP_ID=...
ENABLE_BANKING_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

Después:

```bash
npm run dev
```

y abre [http://localhost:3000](http://localhost:3000). La conexión con el banco solo funciona desde la app publicada.

Comprobaciones antes de publicar un cambio: `npx eslint components lib app`, `npx tsc --noEmit -p .` y `npx next build`.

## Stack

- [Next.js 16](https://nextjs.org) (App Router) · React 19 · TypeScript · [Tailwind CSS 4](https://tailwindcss.com)
- [Supabase](https://supabase.com): PostgreSQL, login y reglas de acceso (RLS)
- [Vercel](https://vercel.com): alojamiento y cron
- [Enable Banking](https://enablebanking.com): conexión con el banco (PSD2). El token se firma con `node:crypto`, sin librerías.
- Yahoo Finance y Financial Times: precios

## Límites conocidos

- **Solo euros.** Las cuentas y los movimientos en otras monedas no se leen.
- **Los precios** salen de páginas públicas de Yahoo y Financial Times, sin API oficial: pueden fallar o cambiar. Uso personal.
- **Enable Banking gratis** sirve para tus propias cuentas; algunos bancos no se dejan vincular.
- **Fiscal y proyección son orientativos** (y lo fiscal sigue las normas españolas). Compruébalo con el informe de tu bróker o un asesor.
- Los planes gratuitos de Vercel y Supabase son para uso personal, no comercial.

## Licencia

Copyright © 2026 RubbProyects. **Todos los derechos reservados.** El código se publica para que puedas leerlo y ver cómo está hecho, pero no se puede copiar, modificar, distribuir ni usar sin permiso por escrito. Para pedirlo, abre un *issue*. Ver [LICENSE](LICENSE) (en inglés).
