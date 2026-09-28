import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

const files = [
  ['400', 'fonts/NotoSansJP-Regular.ttf'],
  ['700', 'fonts/NotoSansJP-Bold.ttf'],
] as const;

for (const [weight, file] of files) {
  loadFont({family: 'NotoSansJP', url: staticFile(file), weight});
}

// 等幅: IBM Plex Mono（OFL。public/fonts/OFL.txt 参照）。
// データ・寸法・座標・検証値・CLI 用。和文は NotoSansJP にフォールバックする。
const monoFiles = [
  ['400', 'fonts/IBMPlexMono-Regular.ttf'],
  ['500', 'fonts/IBMPlexMono-Medium.ttf'],
] as const;

for (const [weight, file] of monoFiles) {
  loadFont({family: 'IBMPlexMono', url: staticFile(file), weight});
}
