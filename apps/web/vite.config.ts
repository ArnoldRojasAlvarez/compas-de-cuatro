import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// Los paquetes del monorepo se resuelven desde su fuente, no desde su `dist`
// compilada: asi `npm run dev` y `npm run build` nunca usan codigo viejo ni
// fallan porque falte compilar (la trampa de la dist, ver HANDOFF).
const fuente = (paquete: string): string =>
  fileURLToPath(new URL(`../../packages/${paquete}/src/index.ts`, import.meta.url));

// Solo en `npm run dev`: si el navegador tiene `localStorage['tetra:mudo'] = '1'`
// se silencia todo el audio que suena en la pagina (las conexiones al destino pasan por
// una ganancia en 0; el reloj de audio sigue corriendo igual). Sirve para
// probar sin que suene la musica del menu. Se inyecta antes que la app, asi
// sobrevive a recargas y a HMR. Es por navegador: quien no activa la marca no
// nota nada, y el build de produccion no lo incluye.
const silenciadorDeDesarrollo: Plugin = {
  name: 'tetra-silenciador-dev',
  apply: 'serve',
  transformIndexHtml: () => [
    {
      tag: 'script',
      injectTo: 'head-prepend',
      children: `(function () {
  try { if (localStorage.getItem('tetra:mudo') !== '1') return; } catch (e) { return; }
  var conectar = AudioNode.prototype.connect;
  var mudas = new WeakMap();
  AudioNode.prototype.connect = function (destino) {
    var resto = Array.prototype.slice.call(arguments, 1);
    // Un OfflineAudioContext no suena: renderiza a un buffer (la cancion demo).
    // Silenciarlo dejaria ese buffer vacio, asi que se deja pasar.
    var offline = typeof OfflineAudioContext !== 'undefined' && this.context instanceof OfflineAudioContext;
    if (!offline && typeof AudioDestinationNode !== 'undefined' && destino instanceof AudioDestinationNode) {
      var g = mudas.get(this.context);
      if (!g) {
        g = this.context.createGain();
        g.gain.value = 0;
        conectar.call(g, destino);
        mudas.set(this.context, g);
      }
      return conectar.apply(this, [g].concat(resto));
    }
    return conectar.apply(this, [destino].concat(resto));
  };
})();`,
    },
  ],
};

export default defineConfig({
  // Base relativa: el build funciona en la raiz de un dominio y en un
  // subdirectorio (GitHub Pages) sin cambiar nada. El router es por hash.
  base: './',
  plugins: [silenciadorDeDesarrollo],
  resolve: {
    alias: {
      '@tetra/core': fuente('core'),
      '@tetra/audio': fuente('audio'),
      '@tetra/engine': fuente('engine'),
      '@tetra/storage': fuente('storage'),
    },
  },
});
