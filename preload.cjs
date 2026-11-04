const { contextBridge } = require('electron');

const tokenArgument = process.argv.find(argument => argument.startsWith('--app-api-token='));
if (!tokenArgument) {
    throw new Error('The local API token was not provided to the application window.');
}
const apiBaseArgument = process.argv.find(argument => argument.startsWith('--app-api-base='));

contextBridge.exposeInMainWorld('appSecurity', {
    apiToken: tokenArgument.slice('--app-api-token='.length),
    apiBaseUrl: apiBaseArgument
        ? apiBaseArgument.slice('--app-api-base='.length)
        : '/api'
});
