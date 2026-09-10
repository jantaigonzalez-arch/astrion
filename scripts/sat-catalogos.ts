/**
 * CARGA LOS CATÁLOGOS `c_*` DEL SAT.
 *
 *   npm run sat:catalogos -- --dir ~/Descargas/catCFDI          # ENSAYO
 *   npm run sat:catalogos -- --dir ~/Descargas/catCFDI --aplicar
 *
 * ── ENSAYO POR OMISIÓN ─────────────────────────────────────────────────────
 *
 * Sin `--aplicar` no escribe nada: lee, cuenta, avisa de lo que no entiende y
 * se calla. Es la misma regla que ya sigue la importación de cuentas por pagar,
 * y existe porque un catálogo fiscal cargado a medias es peor que uno vacío:
 * vacío, el sistema DICE que no puede validar; a medias, valida mal y con
 * aplomo.
 *
 * ── DE DÓNDE SALEN LOS ARCHIVOS ────────────────────────────────────────────
 *
 * Del Anexo 20 del SAT, hoja «catCFDI». Se descarga el XLS y se exporta cada
 * hoja a CSV con el nombre de su catálogo:
 *
 *   c_RegimenFiscal.csv   c_UsoCFDI.csv    c_FormaPago.csv
 *   c_MetodoPago.csv      c_Pais.csv       c_CodigoPostal.csv   c_Colonia.csv
 *
 * Los que falten se saltan con un aviso; no hace falta tenerlos todos para
 * cargar los que sí se tienen.
 *
 * ── LA MATRIZ USO ↔ RÉGIMEN SE DERIVA, NO SE ESCRIBE ──────────────────────
 *
 * Sale de la columna «Régimen Fiscal Receptor» de `c_UsoCFDI`, donde el SAT
 * lista por cada uso los regímenes que lo admiten. Escribirla a mano tiene dos
 * problemas y los dos son graves: se equivoca —y el resultado es justamente el
 * CFDI40158 que la tabla existe para evitar— y se queda vieja, porque el SAT la
 * cambia sin avisar a nadie.
 *
 * ── LO QUE NO ENTIENDE, LO DICE ───────────────────────────────────────────
 *
 * Regla 9 de AGENTS.md. Una columna que no se reconoce, una fila sin clave, un
 * régimen citado por un uso que no está en `c_RegimenFiscal`: todo eso sale en
 * el reporte. Degradar en silencio —un `?? null` y seguir— ya metió 633 tickets
 * sin técnico en este mismo repositorio.
 */
import "./_env";
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { createHash } from "node:crypto";

/* ── Lectura de CSV ───────────────────────────────────────────────────────── */

/**
 * Un CSV con comillas, saltos dentro de celda y BOM.
 *
 * Se escribe a mano y no se trae una dependencia: son treinta líneas, el
 * formato del SAT es plano, y añadir un paquete al candado por esto cuesta más
 * —ver la nota de `npm ci` en AGENTS.md— que mantenerlas.
 */
function leerCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let enComillas = false;

  const t = texto.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') enComillas = true;
    else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo);
      campo = "";
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim())) filas.push(fila);
  return filas;
}

/** Sin acentos, sin puntuación y en minúsculas: para casar encabezados. */
const llave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * Encuentra una columna por cualquiera de sus nombres conocidos.
 *
 * El SAT cambia el rótulo entre publicaciones —«Descripción» y «Descripcion»,
 * «Física» y «Aplica para tipo persona Física»— y una lista de alias evita que
 * la carga se rompa por una tilde. Devuelve `-1` si no está, y quien llama
 * decide si eso es fatal o un aviso.
 */
function columna(encabezados: string[], ...alias: string[]): number {
  const norm = encabezados.map(llave);
  for (const a of alias) {
    const i = norm.indexOf(llave(a));
    if (i >= 0) return i;
  }
  return -1;
}

const siNo = (v: string | undefined) => /^s[ií]$/i.test((v ?? "").trim());

/** `dd/mm/aaaa` o `aaaa-mm-dd` → `aaaa-mm-dd`, o nulo si viene vacío o raro. */
function fecha(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mx = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (mx) return `${mx[3]}-${mx[2].padStart(2, "0")}-${mx[1].padStart(2, "0")}`;
  return null;
}

/* ── El trabajo ───────────────────────────────────────────────────────────── */

type Incidencia = { archivo: string; detalle: string };

async function main() {
  const args = process.argv.slice(2);
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  /*
    Por omisión, los catálogos que vienen EN EL REPOSITORIO.

    Están versionados y comprimidos —1,8 MB los siete— así que llegan a
    cualquier entorno con el `git pull` que ya hace el despliegue. No hay que
    copiar nada a ningún servidor, y git contesta la pregunta que importa:
    contra QUÉ versión del catálogo validó producción.

    `--dir` sigue existiendo para cargar una descarga recién bajada del SAT antes
    de versionarla.
  */
  const dir = flag("dir") ?? "datos/sat";
  const aplicar = args.includes("--aplicar");

  const { getDb } = await import("../src/lib/db");
  const {
    satCatalogo,
    satRegimenFiscal,
    satUsoCfdi,
    satUsoRegimen,
    satFormaPago,
    satMetodoPago,
    satPais,
    satCodigoPostal,
    satColonia,
  } = await import("../src/lib/db/platform");
  const db = getDb();

  const incidencias: Incidencia[] = [];
  const resumen: Array<{ catalogo: string; filas: number; nota?: string }> = [];

  /** Lee un archivo si está; si no, lo dice y sigue. */
  const abrir = (nombre: string) => {
    /*
      Se acepta el CSV tal cual y comprimido.

      Los del repositorio van en `.gz` porque el de códigos postales pasa de
      14,5 MB a 303 KB —comprime cuarenta y tres veces, es texto repetitivo— y
      así los siete juntos ocupan 1,8 MB en el árbol de trabajo en vez de
      veintiuno. Se descomprime en memoria: `zlib` viene con Node, así que no
      añade una dependencia al candado.
    */
    const gz = path.join(dir, `${nombre}.gz`);
    const plano = path.join(dir, nombre);
    const p = existsSync(gz) ? gz : plano;

    if (!existsSync(p)) {
      resumen.push({ catalogo: nombre.replace(/\.csv$/, ""), filas: 0, nota: "no está" });
      return null;
    }

    const bytes = readFileSync(p);
    const texto = p.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");

    return {
      filas: leerCsv(texto),
      /*
        El hash es el del archivo TAL COMO ESTÁ EN DISCO, comprimido o no.
        Sirve para saber si dos cargas fueron la misma carga, y comprimir el
        mismo contenido dos veces no da el mismo byte — así que lo que se compara
        es lo que se leyó, no lo que se dedujo.
      */
      hash: createHash("sha256").update(bytes).digest("hex"),
      origen: path.basename(p),
    };
  };

  /**
   * Salta el preámbulo hasta dar con la fila de encabezados.
   *
   * Las hojas del SAT traen un título, la versión del catálogo y una fila en
   * blanco antes de los encabezados de verdad. Se busca la primera fila que
   * contenga la columna clave en vez de suponer que es la primera: suponerlo
   * cargaría el título como si fuera un renglón del catálogo.
   *
   * ── Y LA CABECERA PUEDE OCUPAR DOS FILAS ────────────────────────────────
   *
   * `c_UsoCFDI` pone «Aplica para tipo persona» en una fila y «Física / Moral»
   * en la de abajo; `c_CodigoPostal` hace lo mismo con el huso horario. Leyendo
   * solo la primera, esas columnas no se encuentran y el catálogo entero se
   * queda sin cargar.
   *
   * Se detecta por la PRIMERA CELDA: en una sub-cabecera está vacía —la clave
   * ya se escribió arriba— y en una fila de datos lleva el valor. Con esa regla
   * las cuatro hojas que importan caen del lado correcto, y una hoja de una sola
   * fila de cabecera no se ve afectada.
   */
  const encabezar = (filas: string[][], clave: string) => {
    const i = filas.findIndex((f) => columna(f, clave) >= 0);
    if (i < 0) return null;

    const siguiente = filas[i + 1] ?? [];
    const esSubCabecera = !(siguiente[0] ?? "").trim() && siguiente.some((c) => (c ?? "").trim());

    if (!esSubCabecera) return { cab: filas[i], cuerpo: filas.slice(i + 1) };

    /*
      Se fusionan las dos, y gana la de ABAJO cuando dice algo: es la específica
      —«Física» bajo «Aplica para tipo persona»— y es la que hay que casar.
    */
    const ancho = Math.max(filas[i].length, siguiente.length);
    const cab = Array.from({ length: ancho }, (_, j) =>
      (siguiente[j] ?? "").trim() || (filas[i][j] ?? "").trim(),
    );
    return { cab, cuerpo: filas.slice(i + 2) };
  };

  const registrar = async (nombre: string, filas: number, origen: string, hash: string) => {
    if (!aplicar) return;
    await db
      .insert(satCatalogo)
      .values({ nombre, filas, origen, hashArchivo: hash })
      .onConflictDoUpdate({
        target: satCatalogo.nombre,
        set: { filas, origen, hashArchivo: hash, cargadoEn: new Date() },
      });
  };

  /* ── c_RegimenFiscal ───────────────────────────────────────────────────── */
  const reg = abrir("c_RegimenFiscal.csv");
  const clavesRegimen = new Set<string>();
  if (reg) {
    const h = encabezar(reg.filas, "c_RegimenFiscal");
    if (!h) {
      incidencias.push({ archivo: reg.origen, detalle: "no encontré la columna c_RegimenFiscal" });
    } else {
      const iC = columna(h.cab, "c_RegimenFiscal");
      const iD = columna(h.cab, "Descripción", "Descripcion");
      const iF = columna(h.cab, "Física", "Fisica", "Aplica para tipo persona Física");
      const iM = columna(h.cab, "Moral", "Aplica para tipo persona Moral");
      const iVi = columna(h.cab, "Fecha de inicio de vigencia");
      const iVf = columna(h.cab, "Fecha de fin de vigencia");
      if (iD < 0 || iF < 0 || iM < 0) {
        incidencias.push({
          archivo: reg.origen,
          detalle: `faltan columnas (descripción=${iD}, física=${iF}, moral=${iM}); no se carga`,
        });
      } else {
        const valores = h.cuerpo
          .filter((f) => (f[iC] ?? "").trim())
          .map((f) => {
            clavesRegimen.add(f[iC].trim());
            return {
              clave: f[iC].trim(),
              descripcion: (f[iD] ?? "").trim(),
              aplicaFisica: siNo(f[iF]),
              aplicaMoral: siNo(f[iM]),
              vigenciaInicio: iVi >= 0 ? fecha(f[iVi]) : null,
              vigenciaFin: iVf >= 0 ? fecha(f[iVf]) : null,
            };
          });
        if (aplicar && valores.length) {
          await db
            .insert(satRegimenFiscal)
            .values(valores)
            .onConflictDoUpdate({
              target: satRegimenFiscal.clave,
              set: {
                descripcion: satRegimenFiscal.descripcion,
              },
            })
            .catch(async () => {
              // Un catálogo se REEMPLAZA, no se acumula: si el SAT quitó una
              // clave, dejarla aquí la seguiría ofreciendo en altas nuevas.
              await db.delete(satRegimenFiscal);
              await db.insert(satRegimenFiscal).values(valores);
            });
        }
        resumen.push({ catalogo: "c_RegimenFiscal", filas: valores.length });
        await registrar("c_RegimenFiscal", valores.length, reg.origen, reg.hash);
      }
    }
  }

  /* ── c_UsoCFDI, y de él la matriz ──────────────────────────────────────── */
  const uso = abrir("c_UsoCFDI.csv");
  if (uso) {
    const h = encabezar(uso.filas, "c_UsoCFDI");
    if (!h) {
      incidencias.push({ archivo: uso.origen, detalle: "no encontré la columna c_UsoCFDI" });
    } else {
      const iC = columna(h.cab, "c_UsoCFDI");
      const iD = columna(h.cab, "Descripción", "Descripcion");
      const iF = columna(h.cab, "Aplica para tipo persona Física", "Física", "Fisica");
      const iM = columna(h.cab, "Aplica para tipo persona Moral", "Moral");
      const iR = columna(h.cab, "Régimen Fiscal Receptor", "Regimen Fiscal Receptor");
      const iVi = columna(h.cab, "Fecha de inicio de vigencia");
      const iVf = columna(h.cab, "Fecha de fin de vigencia");

      if (iD < 0 || iF < 0 || iM < 0) {
        incidencias.push({ archivo: uso.origen, detalle: "faltan columnas básicas; no se carga" });
      } else {
        const usos = h.cuerpo
          .filter((f) => (f[iC] ?? "").trim())
          .map((f) => ({
            clave: f[iC].trim(),
            descripcion: (f[iD] ?? "").trim(),
            aplicaFisica: siNo(f[iF]),
            aplicaMoral: siNo(f[iM]),
            vigenciaInicio: iVi >= 0 ? fecha(f[iVi]) : null,
            vigenciaFin: iVf >= 0 ? fecha(f[iVf]) : null,
          }));

        const pares: Array<{ usoCfdi: string; regimenFiscal: string }> = [];
        if (iR < 0) {
          /*
            SIN ESA COLUMNA NO HAY MATRIZ, Y SE DICE.

            Es el único dato del que no hay sustituto: sin ella, el sistema no
            puede saber qué uso admite qué régimen y el CFDI40158 se cuela. No
            se inventa un valor por omisión —«todos con todos» sería peor que
            nada, porque parecería una comprobación—.
          */
          incidencias.push({
            archivo: uso.origen,
            detalle:
              "falta la columna «Régimen Fiscal Receptor»: la matriz uso↔régimen NO se puede " +
              "derivar y el CFDI40158 seguirá sin comprobarse",
          });
        } else {
          for (const f of h.cuerpo) {
            const u = (f[iC] ?? "").trim();
            if (!u) continue;
            for (const r of (f[iR] ?? "").split(/[,;\n]/)) {
              const clave = r.trim();
              if (!clave) continue;
              if (clavesRegimen.size && !clavesRegimen.has(clave)) {
                incidencias.push({
                  archivo: uso.origen,
                  detalle: `el uso ${u} cita el régimen ${clave}, que no está en c_RegimenFiscal`,
                });
                continue;
              }
              pares.push({ usoCfdi: u, regimenFiscal: clave });
            }
          }
        }

        if (aplicar && usos.length) {
          await db.delete(satUsoRegimen);
          await db.delete(satUsoCfdi);
          await db.insert(satUsoCfdi).values(usos);
          if (pares.length) await db.insert(satUsoRegimen).values(pares);
        }
        resumen.push({ catalogo: "c_UsoCFDI", filas: usos.length });
        resumen.push({
          catalogo: "  └ matriz uso↔régimen",
          filas: pares.length,
          nota: pares.length ? "derivada" : "SIN DERIVAR",
        });
        await registrar("c_UsoCFDI", usos.length, uso.origen, uso.hash);
      }
    }
  }

  /* ── Los tres catálogos de dos columnas ────────────────────────────────── */
  const simples = [
    { archivo: "c_FormaPago.csv", clave: "c_FormaPago", tabla: satFormaPago, nombre: "c_FormaPago" },
    { archivo: "c_MetodoPago.csv", clave: "c_MetodoPago", tabla: satMetodoPago, nombre: "c_MetodoPago" },
    { archivo: "c_Pais.csv", clave: "c_Pais", tabla: satPais, nombre: "c_Pais" },
  ] as const;

  for (const s of simples) {
    const a = abrir(s.archivo);
    if (!a) continue;
    const h = encabezar(a.filas, s.clave);
    if (!h) {
      incidencias.push({ archivo: a.origen, detalle: `no encontré la columna ${s.clave}` });
      continue;
    }
    const iC = columna(h.cab, s.clave);
    const iD = columna(h.cab, "Descripción", "Descripcion");
    if (iD < 0) {
      incidencias.push({ archivo: a.origen, detalle: "no encontré la descripción; no se carga" });
      continue;
    }
    const valores = h.cuerpo
      .filter((f) => (f[iC] ?? "").trim())
      .map((f) => ({ clave: f[iC].trim(), descripcion: (f[iD] ?? "").trim() }));
    if (aplicar && valores.length) {
      await db.delete(s.tabla);
      await db.insert(s.tabla).values(valores);
    }
    resumen.push({ catalogo: s.nombre, filas: valores.length });
    await registrar(s.nombre, valores.length, a.origen, a.hash);
  }

  /* ── c_CodigoPostal y c_Colonia: los grandes ───────────────────────────── */
  const cp = abrir("c_CodigoPostal.csv");
  if (cp) {
    const h = encabezar(cp.filas, "c_CodigoPostal");
    if (!h) {
      incidencias.push({ archivo: cp.origen, detalle: "no encontré la columna c_CodigoPostal" });
    } else {
      const iC = columna(h.cab, "c_CodigoPostal");
      const iE = columna(h.cab, "c_Estado");
      const iM = columna(h.cab, "c_Municipio");
      const iL = columna(h.cab, "c_Localidad");
      const iH = columna(
        h.cab,
        "Descripción del Huso Horario",
        "Referencias del Huso Horario",
        "Huso Horario",
      );
      const iF = columna(h.cab, "Estímulo Franja Fronteriza", "Estimulo Franja Fronteriza");

      const vistos = new Set<string>();
      const valores = h.cuerpo
        .filter((f) => /^\d{5}$/.test((f[iC] ?? "").trim()))
        .filter((f) => {
          // El catálogo trae un renglón por colonia, así que el CP se repite.
          const k = f[iC].trim();
          if (vistos.has(k)) return false;
          vistos.add(k);
          return true;
        })
        .map((f) => ({
          cp: f[iC].trim(),
          estado: iE >= 0 ? (f[iE] ?? "").trim() || null : null,
          municipio: iM >= 0 ? (f[iM] ?? "").trim() || null : null,
          localidad: iL >= 0 ? (f[iL] ?? "").trim() || null : null,
          husoHorario: iH >= 0 ? (f[iH] ?? "").trim() || null : null,
          estimuloFranjaFronteriza:
            iF >= 0 && (f[iF] ?? "").trim() ? (f[iF] ?? "").trim() : null,
        }));

      if (aplicar && valores.length) {
        await db.delete(satColonia);
        await db.delete(satCodigoPostal);
        // Por lotes: cincuenta mil parámetros en una sentencia no pasan.
        for (let i = 0; i < valores.length; i += 2000) {
          await db.insert(satCodigoPostal).values(valores.slice(i, i + 2000));
        }
      }
      resumen.push({ catalogo: "c_CodigoPostal", filas: valores.length });
      await registrar("c_CodigoPostal", valores.length, cp.origen, cp.hash);

      /* Las colonias van después: apuntan al CP con una llave foránea. */
      const col = abrir("c_Colonia.csv");
      if (col) {
        const hc = encabezar(col.filas, "c_CodigoPostal");
        if (!hc) {
          incidencias.push({ archivo: col.origen, detalle: "no encontré la columna del CP" });
        } else {
          const jCp = columna(hc.cab, "c_CodigoPostal");
          const jCl = columna(hc.cab, "c_Colonia");
          const jNo = columna(hc.cab, "Nombre del asentamiento", "Nombre", "Descripción");
          if (jCl < 0 || jNo < 0) {
            incidencias.push({ archivo: col.origen, detalle: "faltan columnas; no se carga" });
          } else {
            const parejas = new Set<string>();
            const valoresCol = hc.cuerpo
              .filter((f) => vistos.has((f[jCp] ?? "").trim()))
              .filter((f) => {
                const k = `${f[jCp].trim()}|${(f[jCl] ?? "").trim()}`;
                if (parejas.has(k)) return false;
                parejas.add(k);
                return true;
              })
              .map((f) => ({
                cp: f[jCp].trim(),
                clave: (f[jCl] ?? "").trim(),
                nombre: (f[jNo] ?? "").trim(),
              }));

            const huerfanas = hc.cuerpo.length - valoresCol.length;
            if (huerfanas > 0) {
              incidencias.push({
                archivo: col.origen,
                detalle: `${huerfanas} colonia(s) con un CP que no está en c_CodigoPostal o repetidas; se omiten`,
              });
            }
            if (aplicar && valoresCol.length) {
              for (let i = 0; i < valoresCol.length; i += 2000) {
                await db.insert(satColonia).values(valoresCol.slice(i, i + 2000));
              }
            }
            resumen.push({ catalogo: "c_Colonia", filas: valoresCol.length });
            await registrar("c_Colonia", valoresCol.length, col.origen, col.hash);
          }
        }
      }
    }
  }

  /* ── Reporte ───────────────────────────────────────────────────────────── */
  console.log(`\n${aplicar ? "CARGA APLICADA" : "ENSAYO — no se escribió nada"}\n`);
  for (const r of resumen) {
    console.log(
      `  ${r.catalogo.padEnd(24)} ${String(r.filas).padStart(7)}${r.nota ? `  · ${r.nota}` : ""}`,
    );
  }

  if (incidencias.length) {
    console.log(`\n⚠ ${incidencias.length} incidencia(s):\n`);
    for (const i of incidencias.slice(0, 40)) console.log(`  ${i.archivo}: ${i.detalle}`);
    if (incidencias.length > 40) console.log(`  … y ${incidencias.length - 40} más`);
  }

  if (!aplicar) {
    console.log("\nPara escribirlo de verdad, repetí con --aplicar\n");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
