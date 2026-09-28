import {Composition} from 'remotion';
import './fonts';
import {MachimokiDemo} from './MachimokiDemo';
import {SmokeTest} from './SmokeTest';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MachimokiDemoV1"
        component={MachimokiDemo}
        durationInFrames={1800}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="SmokeTest"
        component={SmokeTest}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
