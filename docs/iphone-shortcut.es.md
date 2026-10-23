[English](iphone-shortcut.md) · **Español**

# Captura instantánea de gastos con un atajo del iPhone

Cada vez que pagas con Apple Pay, tu iPhone envía el pago a la app **en ese momento**. La app
apunta el gasto al instante. Días después, cuando el banco muestra el mismo pago, la app los
empareja y no queda nada duplicado.

> No disponible en la demo pública. Necesita iOS 17 o posterior. Solo ve los pagos con **Apple
> Pay** (acercar el móvil o el reloj): tarjeta física, Bizum y transferencias siguen llegando
> por el banco.

## 1. En la app

1. Abre **Ajustes → ⚡ Captura instantánea (iPhone)**.
2. Pulsa **Crear clave** y copia la clave (empieza por `mf_`). Solo se muestra una vez.
3. Copia la dirección que aparece debajo (termina en `/api/capture`).

## 2. En la app Atajos del iPhone

1. Abre **Atajos → Automatización → + → Transacción** (en algunas versiones se llama **Cartera**).
2. Elige las tarjetas que quieras y marca **Ejecutar inmediatamente**. Pulsa **Siguiente**.
3. Añade la acción **Formatear fecha**: Fecha = *Fecha actual*, Formato de fecha = *Personalizado*, y el texto de formato `yyyy-MM-dd`.
4. Añade la acción **Obtener contenido de URL** y configúrala:
   - **URL:** la dirección que copiaste.
   - **Método:** POST.
   - **Cabeceras:** `Authorization` = `Bearer ` seguido de tu clave (con un espacio tras Bearer) y `Content-Type` = `application/json`.
   - **Cuerpo de la solicitud:** JSON, con estos campos (tipo Texto):
     - `merchant` = el *Comercio* de la **Entrada del atajo**
     - `amount` = el *Importe* de la **Entrada del atajo**
     - `card` = la *Tarjeta o pase* de la **Entrada del atajo**
     - `date` = el resultado de **Formatear fecha**
5. Pulsa **OK**.

## 3. El primer pago

El primer pago de cada tarjeta llega como «falta asignar la tarjeta»: ve a **Ajustes → ⚡ Captura
instantánea → 2. Tarjetas y cuentas** y elige a qué cuenta de la app pertenece. Los pagos que
esperaban se apuntan en ese momento.

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
