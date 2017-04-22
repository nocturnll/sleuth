import * as React from 'react';
import { Loading } from '../../../src/renderer/components/loading';
import * as renderer from 'react-test-renderer';

it('loading renders correctly', () => {
  const tree = renderer.create(
    <Loading percentage={20} message='Hello' />
  ).toJSON();

  expect(tree).toMatchSnapshot();
});