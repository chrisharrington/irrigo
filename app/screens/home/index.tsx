import { View, Text } from 'react-native';
import { Screen } from '@/components/screen';

export function HomeScreen() {
    return (
        <Screen>
            <Text className='text-xl font-bold text-blue-500'>Welcome to Nativewind!</Text>
        </Screen>
    );
}
