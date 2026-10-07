# Lectura de respuestas en Home

Guillem aprobo el7deoctubre: frases breves centradas; respuestas largas/listas a izquierda; tarjeta acotada con scroll interno, iconos y voz fijos; durante escritura seguir final excepto al leer arriba, reanudar al volver al final.

Implementacion1578554, rama codex/home-reply-reading-2026-10-07. Politica: izquierda si mas de120caracteres, lista con guion/asterisco/bullet/numerada o mas de4lineas no vacias. Mantiene fuente26/Dynamic Type, seleccion y acceso a escribir. Viewport explicito entre navegacion y borde de tarjeta; contenido conserva altura natural. ScrollViewReader sigue final sin animacion por token; drag suspende, margen24pt al final reanuda incluso tras deceleracion. Nuevo ID/cuenta reinicia seguimiento/posicion; final durable conserva ID del borrador para no perder pausa del lector.

Pruebas nativas cubren saludo corto, listas, respuesta larga, pausa con crecimiento, regreso al final y nuevo turno. XCTest comprueba final de respuesta larga dentro de tarjeta y voz/iconos fijos. CI37597049359 fuente df8d1ee: pruebas nativas, build Simulator y siete XCTest Home correctos; capturas Home en curso. Primera pasada37595346186 fallo al buscar ScrollView por identificador sobrescrito por el contenedor; consulta nativa firstMatch corregida en df8d1ee. Presupuesto UI15/job40min para arranque lento. Harness inicial70/70; cierre df8d1ee69/70, unico release_gate_quick por replay revisado/0casos fisicos previos de publicacion. Scope sin infracciones con baseline e1d7169 y diff explicito, recibo tmp/product-harness/home-reading-scope.json. No se rebajo el gate.

Este cambio no esta en archive105(fb9879f); necesita nueva build para iPhone. Subida105 seguia bloqueada por cuenta Apple; no se acredita distribucion del nuevo cambio.
