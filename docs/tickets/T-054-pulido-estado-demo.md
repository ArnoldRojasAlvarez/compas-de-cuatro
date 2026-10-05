# T-054 · Pulido del estado demo

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Rama** | `fix/pulido-demo` (worktree) |
| **Depende de** | T-049 a T-053 |

## Contexto

Hallazgos de la revision en navegador de T-049 a T-053, con canciones reales
(fondos muy cargados y sets con varias dificultades).

## Que arreglar

1. **Legibilidad del menu sobre fondos cargados.** Con una portada de mucho
   contraste (rojo y blanco, texto grande en la imagen), los botones
   secundarios Mapeador y Ajustes casi no se leen. Arreglo: los botones del
   menu llevan fondo `--superficie` al ~85 % con `backdrop-filter: blur(8px)`
   y borde `--linea`; el velo del menu oscurece un poco mas el centro (vineta
   inversa: centro mas oscuro donde esta el logo y los botones, bordes con mas
   imagen). La linea de "lo que suena" igual: un fondo translucido detras.
   Revisar lo mismo en el song select (chips de dificultad, barras del perfil
   y los iconos sobre un fondo claro) y en la partida (HUD de precision sobre
   un fondo claro: sombra de texto sutil).

2. **Orden de las dificultades.** Hoy salen en el orden del zip (alfabetico:
   "another, drago's insane, hard, intermediate, sky blue"). Deben salir de la
   mas facil a la mas dificil. Criterio inmediato y estable (sin esperar al
   worker): densidad de notas (notas por segundo entre la primera y la ultima
   nota), desempate por cantidad de notas y despues por nombre. Funcion pura
   `ordenarDificultades(charts: readonly Chart[]): Chart[]` en
   `song-select-logica.ts`, con tests, aplicada al cargar la biblioteca (el
   indice enfocado se refiere a la lista ya ordenada). La musica del menu toma
   el `previewTime` de la primera tras ordenar (da igual cual, comparten audio).

3. **Audio de la primera dificultad ausente.** Hay sets reales donde la
   primera dificultad declara un `AudioFilename` que no esta en el zip pero
   otras si tienen su audio. `extraerCancionDeOsz` (storage) debe probar el
   audio de cada dificultad en orden y quedarse con el primero que exista;
   solo si ninguno existe, el error de siempre. Test en `osz.test.ts`.

4. **Errores de importacion que no se van.** En el song select el mensaje de
   error de una importacion fallida queda para siempre al pie. Debe tener un
   boton-icono de cerrar y desaparecer solo al importar algo con exito o al
   cambiar de pantalla. Texto corto: "No se pudo importar <archivo>" y el
   detalle tecnico en `title`.

5. **Primera musica del menu lenta.** Decodificar una cancion completa tarda
   (en una maquina lenta, segundos). Mientras tanto el menu esta mudo y sin
   fondo. Mostrar el fondo de la cancion elegida **apenas se elige** (antes de
   decodificar), y la linea de "lo que suena" con el titulo atenuado hasta que
   arranca. Sin cambiar el reloj ni el contexto de audio.

## Criterios de aceptacion

- [ ] Menu legible con un fondo claro y cargado (probar con una imagen casi
      blanca y con una de mucho contraste).
- [ ] Dificultades de facil a dificil en el song select.
- [ ] Un `.osz` cuya primera dificultad declara un audio ausente importa.
- [ ] El error de importacion se puede cerrar.
- [ ] Los cuatro checks y el e2e en verde.

## Fuera de alcance

Cambios de layout grandes. Records. Hitsounds.
