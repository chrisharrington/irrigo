import { View } from 'react-native';

type TileProps = {
    children?: React.ReactNode;
    className?: string;
};

export function Tile({ children, className }: TileProps) {
    return <View className={`bg-background-500 rounded-lg p-4 shadow-md ${className ?? ''}`}>{children}</View>;
}
