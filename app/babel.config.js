module.exports = function (api) {
    api.cache(true);
    return {
        presets: [
            ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
            'nativewind/babel',
        ],
        // Required by Reanimated 4 / react-native-worklets. Must be the LAST
        // plugin so it runs after every other transform has produced its
        // final output (see react-native-worklets docs).
        plugins: ['react-native-worklets/plugin'],
    };
};
