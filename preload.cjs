const { contextBridge } = require('electron');

const tokenArgument = process.argv.find(argument => argument.startsWith('--app-api-token='));
if (!tokenArgument) {
    throw new Error('The local API token was not provided to the application window.');
}

contextBridge.exposeInMainWorld('appSecurity', {
    apiToken: tokenArgument.slice('--app-api-token='.length)
});
