// 全シーンの <Sequence> 合成。コンポジション契約は変更しない。
import {AbsoluteFill, Sequence} from 'remotion';
import {COLORS, SCENES} from './config';
import {Scene01Title} from './scenes/Scene01Title';
import {Scene02Problem} from './scenes/Scene02Problem';
import {Scene03Solution} from './scenes/Scene03Solution';
import {Scene04Select} from './scenes/Scene04Select';
import {Scene05Preview} from './scenes/Scene05Preview';
import {Scene06Export} from './scenes/Scene06Export';
import {Scene07Showcase} from './scenes/Scene07Showcase';
import {Scene08Outro} from './scenes/Scene08Outro';

export const MachimokiDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: COLORS.ground}}>
      <Sequence from={SCENES.s1.from} durationInFrames={SCENES.s1.duration}>
        <Scene01Title />
      </Sequence>
      <Sequence from={SCENES.s2.from} durationInFrames={SCENES.s2.duration}>
        <Scene02Problem />
      </Sequence>
      <Sequence from={SCENES.s3.from} durationInFrames={SCENES.s3.duration}>
        <Scene03Solution />
      </Sequence>
      <Sequence from={SCENES.s4.from} durationInFrames={SCENES.s4.duration}>
        <Scene04Select />
      </Sequence>
      <Sequence from={SCENES.s5.from} durationInFrames={SCENES.s5.duration}>
        <Scene05Preview />
      </Sequence>
      <Sequence from={SCENES.s6.from} durationInFrames={SCENES.s6.duration}>
        <Scene06Export />
      </Sequence>
      <Sequence from={SCENES.s7.from} durationInFrames={SCENES.s7.duration}>
        <Scene07Showcase />
      </Sequence>
      <Sequence from={SCENES.s8.from} durationInFrames={SCENES.s8.duration}>
        <Scene08Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
