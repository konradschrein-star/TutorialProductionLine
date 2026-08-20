import { registerRoot, Composition as RemotionComposition } from "remotion";
import { Composition, type CompositionProps } from "./Composition";

// Wrapper component to handle Remotion's generic prop typing
const CompositionWrapper: React.FC = (props: any) => {
  return <Composition {...(props as CompositionProps)} />;
};

export const RemotionRoot = () => {
  const defaultProps: CompositionProps = {
    captions: [],
    animationType: "fade",
    style: {
      fontFamily: "Arial, sans-serif",
      fontSize: 48,
      primaryColor: "white",
      position: "bottom",
    },
  };

  return (
    <RemotionComposition
      id="animated-subtitles"
      component={CompositionWrapper}
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={defaultProps}
    />
  );
};

registerRoot(RemotionRoot);
