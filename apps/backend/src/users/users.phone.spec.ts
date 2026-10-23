import { withDefaultPrefix } from './users.service';

it('adds +91 only when no country code is given', () => {
  expect(withDefaultPrefix('9876543210')).toBe('+91 9876543210');
  expect(withDefaultPrefix(' +1 555 0100 ')).toBe('+1 555 0100 '.trim());
  expect(withDefaultPrefix('')).toBe('');
  expect(withDefaultPrefix(undefined)).toBeUndefined();
});
