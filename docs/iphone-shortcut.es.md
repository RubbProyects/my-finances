[English](iphone-shortcut.md) · **Español**

# Captura instantánea de gastos con un atajo del iPhone

Cada vez que pagas con Apple Pay, tu iPhone envía el pago a la app **en ese momento**. La app
apunta el gasto al instante y el iPhone te pregunta **en qué categoría** quieres guardarlo. Días
después, cuando el banco muestra el mismo pago, la app los empareja y no queda nada duplicado.

> No disponible en la demo pública. Necesita iOS 17 o posterior. Solo ve los pagos con **Apple
> Pay** (acercar el móvil o el reloj): tarjeta física, Bizum y transferencias siguen llegando
> por el banco.

## 1. En la app

1. Abre **Ajustes → ⚡ Captura instantánea (iPhone)**.
2. Pulsa **Crear clave** y copia la clave (empieza por `mf_`). Solo se muestra una vez.
3. Copia la dirección que aparece debajo (termina en `/api/capture`). Tiene que ser la de la app
   publicada, no la de una vista previa de Vercel.

## 2. Probar sin pagar (recomendado)

1. En **Atajos**, crea un atajo nuevo (**+**) con la acción **Obtener contenido de URL**.
2. URL: la dirección que copiaste. En **Mostrar más**: Método **POST**.
3. **Cabeceras:** `Authorization` = `Bearer ` (con un espacio) seguido de tu clave, y `Content-Type` = `application/json`.
4. **Cuerpo de la solicitud: JSON**, con tres campos de tipo Texto: `merchant` = `Prueba`, `amount` = `1,00`, `card` = `Tarjeta de prueba`.
5. Ejecútalo (▶). Debe responder algo como `{"ok":true,"status":"unmapped",...}`. En la app, en
   **Ajustes → ⚡ Captura instantánea**, aparece la tarjeta y el pago de prueba; quítalo con la ✕.

## 3. La automatización con Apple Pay

1. En **Atajos → Automatización → +**, busca **Cartera** (en algunas versiones de iOS se llama
   **Transacción**). Es una automatización **personal**.
2. Elige solo tus **tarjetas de pago**, marca **Ejecutar inmediatamente** y pulsa **Siguiente**.
3. Pulsa **Crear atajo nuevo** y, en la **Entrada del atajo**, pon el **Tipo** en **Transacción**:
   así existen las variables **Importe** y **Comercio**.
4. Añade las acciones, en este orden:
   1. **Formatear fecha**: Fecha = *Fecha actual*, Formato = *Personalizado*, texto `yyyy-MM-dd`.
   2. **Obtener contenido de URL** (como en la prueba de arriba) con estos campos de tipo Texto:
      `merchant` = **Entrada del atajo → Comercio**, `amount` = **Entrada del atajo → Importe**,
      `card` = **Entrada del atajo → Tarjeta o pase**, `date` = el resultado de **Formatear fecha**.
   3. **Definir variable** `respuesta` con el **Contenido de la URL**.
   4. **Obtener valor del diccionario**: la clave `categories` de `respuesta`.
   5. **Elegir de la lista**, con la lista del paso anterior (mensaje: «Categoría»).
   6. **Definir variable** `categoria` con el **Elemento elegido**.
   7. **Obtener valor del diccionario**: la clave `id` de `respuesta`.
   8. **Obtener contenido de URL** a la **misma dirección terminada en `/api/capture/category`**
      (en vez de `/api/capture`), Método **POST**, las mismas dos cabeceras, y JSON con dos campos
      de tipo Texto: `id` = el valor del paso 7 y `category` = la variable `categoria`.
5. Pulsa **OK**.

La primera opción de la lista es **⚡ Automática**: deja la categoría que decidan tus reglas del
banco. Después salen tus categorías de gasto, **las que más usas primero**. Si cierras la lista
sin elegir, el pago **ya está apuntado** con la categoría automática: no se pierde nada.

## 4. El primer pago

El primer pago de cada tarjeta llega como «falta asignar la tarjeta» (y sin lista de categorías):
ve a **Ajustes → ⚡ Captura instantánea → 2. Tarjetas y cuentas** y elige a qué cuenta de la app
pertenece. Los pagos que esperaban se apuntan en ese momento, con la categoría de tus reglas.

## Cómo evita los duplicados

Cuando llega el movimiento del banco, se empareja con un gasto capturado de la **misma cuenta y el
mismo importe, al céntimo**, cuya fecha va desde 1 día antes hasta 7 días después del día en que
pagaste. Si encajan varios, va primero el que tiene el texto del comercio más parecido y luego el
más cercano en el tiempo. El apartado **3. Últimos pagos recibidos** te dice cuántos días suele
tardar tu banco.

## Lo que sigue necesitando tu mano

- Pagos en otra moneda (el atajo ve dólares y el banco euros) y propinas añadidas después de
  pagar: se quedan sin pareja y los enlazas a mano desde la bandeja del banco.
- Un pago rechazado también puede disparar el atajo: a los 10 días sale como «el banco no lo
  muestra»; quítalo con la ✕.
- Esta automatización de Apple a veces tarda o falla cuando el banco avisa tarde a Cartera
  (sobre todo en iOS 18 y posteriores). Si pasa, el pago sigue llegando por el banco.
