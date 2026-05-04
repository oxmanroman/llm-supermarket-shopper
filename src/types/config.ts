import { CustomThemes } from '~/types';

export interface Env {}

export interface Constants {}

export interface Config {
  env: Env;
  constants: Constants;
  customThemes: CustomThemes;
}
