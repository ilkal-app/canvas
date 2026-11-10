import { describe, expect, it } from 'vitest';

import * as engine from '../index.js';

import { ATLAS_LOAN_MARGIN_SHARE, AtlasLoan } from './atlas-loan.js';

interface LoanUnderTest {
  readonly lendableBytes: number;
  readonly borrowedBytes: number;
  readonly textureCapBytes: number;
  reportTextures(residentBytes: number, wantedBytes: number): void;
  attachBorrower(borrowed: () => number): void;
}

const LOAN_CONSTRUCTOR = AtlasLoan as unknown as new (options: {
  texturesBytes: number;
  marginBytes?: number;
}) => LoanUnderTest;
const MARGIN_SHARE = ATLAS_LOAN_MARGIN_SHARE;

describe('AtlasLoan', () => {
  it('exports the loan and its margin share from the engine package', () => {
    expect(engine).toHaveProperty('AtlasLoan', AtlasLoan);
    expect(engine).toHaveProperty('ATLAS_LOAN_MARGIN_SHARE', MARGIN_SHARE);
  });

  it('holds the default margin before any texture report and gives it back as demand grows', () => {
    const loan = new LOAN_CONSTRUCTOR({ texturesBytes: 800 });
    const margin = 800 * MARGIN_SHARE;

    expect(MARGIN_SHARE).toBe(1 / 8);
    expect(loan.lendableBytes).toBe(800 - margin);
    loan.reportTextures(200, 500);
    expect(loan.lendableBytes).toBe(800 - 500 - margin);
    loan.reportTextures(600, 300);
    expect(loan.lendableBytes).toBe(800 - 600 - margin);
  });

  it('uses an explicit margin and never lends negative headroom', () => {
    const loan = new LOAN_CONSTRUCTOR({ texturesBytes: 1_000, marginBytes: 50 });

    expect(loan.lendableBytes).toBe(950);
    loan.reportTextures(200, 400);
    expect(loan.lendableBytes).toBe(550);
    loan.reportTextures(1_100, 700);
    expect(loan.lendableBytes).toBe(0);
    loan.reportTextures(0, 0);
    expect(loan.lendableBytes).toBe(950);
  });

  it('reads the live borrower, clamps negative borrowing and reduces the texture cap', () => {
    const loan = new LOAN_CONSTRUCTOR({ texturesBytes: 1_000, marginBytes: 0 });
    let borrowed = 120;

    expect([loan.borrowedBytes, loan.textureCapBytes]).toEqual([0, 1_000]);
    loan.attachBorrower(() => borrowed);
    expect([loan.borrowedBytes, loan.textureCapBytes]).toEqual([120, 880]);
    borrowed = 300;
    expect([loan.borrowedBytes, loan.textureCapBytes]).toEqual([300, 700]);
    borrowed = -20;
    expect([loan.borrowedBytes, loan.textureCapBytes]).toEqual([0, 1_000]);
  });
});
