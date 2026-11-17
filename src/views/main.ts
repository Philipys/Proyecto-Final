import { MissionApiClient } from '../services/MissionApiClient.js';
import { NavigatorViewModel } from '../viewmodels/NavigatorViewModel.js';
import { HudConsoleView } from './HudConsoleView.js';

const apiClient = new MissionApiClient('/api');
const viewModel = new NavigatorViewModel(apiClient);
const hudView = new HudConsoleView(viewModel);

hudView.mount();
void viewModel.initialize();
