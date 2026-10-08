# T-061 · Diagnostico de tirones en la partida real

| | |
|---|---|
| **Fase** | 5 · Estado demo |
| **Modelo** | Sonnet |
| **Prioridad** | Alta: Arnold ve tirones de hasta 133 ms en su Chrome (8 de octubre) |
| **Depende de** | T-059 (contador y arnes), T-060 (en paralelo: tocar `game.ts` lo minimo) |

## Contexto

T-059 midio en headless (sin vsync real ni otros programas) y vio un solo
tiron por partida, dentro del driver de GPU. Arnold, jugando en su Chrome con
el contador nuevo, ve tirones de hasta 133 ms. Hay que medir **en su
navegador**, mientras juega, y traer los datos.

## Contrato

`apps/web/src/diagnostico-tirones.ts` (nuevo) + logica pura en
`diagnostico-tirones-logica.ts` (con tests):

```ts
export interface Tiron {
  /** ms de reloj de juego cuando ocurrio. */
  tJuego: number;
  /** Duracion del frame (rAF timestamp a timestamp). */
  duracionMs: number;
  /** De long-animation-frame si el navegador lo da: tiempo de script, de estilo/layout,
   *  bloqueo, y las fuentes de script (sourceURL, sourceFunctionName, duration) truncadas a 5. */
  loaf?: { scriptMs: number; estiloLayoutMs: number; bloqueoMs: number; fuentes: { url: string; funcion: string; ms: number }[] };
  /** Notas visibles y golpes en ese frame (contexto de carga). */
  notasVisibles?: number;
}
export interface Diagnostico {
  iniciar(): void;                 // PerformanceObserver de 'long-animation-frame' y 'longtask' si existen
  frame(tJuego: number, tsRaf: number): void;  // lo llama el bucle; sin allocaciones salvo al registrar un tiron
  detener(): ResumenDiagnostico;   // tirones > 50 ms (tope 200), conteos > 20/33/50 ms, p50/p99, contexto
}
```

- Contexto que se guarda una vez por partida: `navigator.userAgent`, renderer
  WebGL (`UNMASKED_RENDERER`), `devicePixelRatio`, tamano de ventana,
  `ctx.baseLatency`/`outputLatency`, skin, atenuacion, video si/no, contadores,
  baja latencia si/no, mapa (titulo, dificultad, notas), y si la pestana perdio
  el foco o se oculto durante la partida (`visibilitychange`, `blur`).
- Se activa solo con "Mostrar FPS" encendido (asi no cuesta nada al jugador
  comun).
- `game.ts`: solo crear el diagnostico, llamarlo en el bucle con el timestamp
  del rAF (diagnostico, no gameplay) y pasar el resumen a resultados. Nada mas.
- Resultados: si hubo tirones > 50 ms, una linea chica en mono:
  `3 tirones · peor 133 ms a 38,0 s` con `title` listando hasta 10, y un
  boton-icono "Copiar diagnóstico" que copia el JSON completo al portapapeles
  (para pegarlo en el chat). Sin tirones, nada.

## Criterios de aceptacion

- [ ] Con un bloqueo artificial de 120 ms inyectado en la pagina durante una
      partida (e2e), resultados muestra el tiron con ~120 ms en el momento
      correcto, y el JSON copiado trae la atribucion de script si el navegador
      soporta long-animation-frame (Chromium si).
- [ ] Con "Mostrar FPS" apagado no se crea ningun observer.
- [ ] Sin allocaciones por frame en el camino sin tiron.
- [ ] Los cuatro checks y el e2e completo en verde.

## Fuera de alcance

Arreglar los tirones (se decide con los datos que traiga esto).
