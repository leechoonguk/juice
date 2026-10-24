/**
 * The window's entry point: the React Native app itself, rendered by
 * react-native-web.
 */
import { AppRegistry } from 'react-native';

import App from '../../../App';

AppRegistry.registerComponent('Juice', () => App);
AppRegistry.runApplication('Juice', { rootTag: document.getElementById('root') });
