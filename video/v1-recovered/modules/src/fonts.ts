import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';

const files = [
  ['400', 'fonts/NotoSansJP-Regular.ttf'],
  ['700', 'fonts/NotoSansJP-Bold.ttf'],
  ['900', 'fonts/NotoSansJP-Black.ttf'],
] as const;

for (const [weight, file] of files) {
  loadFont({family: 'NotoSansJP', url: staticFile(file), weight});
}
