use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("MoltFlip111111111111111111111111111111111");

#[program]
pub mod moltflip {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, authority: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.authority = authority;
        cfg.mint = ctx.accounts.mint.key();
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn create_match(ctx: Context<CreateMatch>, stake: u64) -> Result<()> {
        require!(stake > 0, MoltFlipError::InvalidStake);

        let m = &mut ctx.accounts.match_account;
        m.config = ctx.accounts.config.key();
        m.creator = ctx.accounts.creator.key();
        m.joiner = Pubkey::default();
        m.stake = stake;
        m.status = MatchStatus::Open;
        m.bump = ctx.bumps.match_account;

        // move creator stake into vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.creator_ata.to_account_info(),
            to: ctx.accounts.vault_ata.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, stake)?;

        Ok(())
    }

    pub fn join_match(ctx: Context<JoinMatch>) -> Result<()> {
        let m = &mut ctx.accounts.match_account;
        require!(m.status == MatchStatus::Open, MoltFlipError::MatchNotOpen);
        require!(m.joiner == Pubkey::default(), MoltFlipError::AlreadyJoined);
        require!(m.creator != ctx.accounts.joiner.key(), MoltFlipError::CreatorCannotJoin);

        m.joiner = ctx.accounts.joiner.key();
        m.status = MatchStatus::Locked;

        // move joiner stake into vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.joiner_ata.to_account_info(),
            to: ctx.accounts.vault_ata.to_account_info(),
            authority: ctx.accounts.joiner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, m.stake)?;

        Ok(())
    }

    pub fn settle_match(ctx: Context<SettleMatch>, winner: Pubkey) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(ctx.accounts.authority.key() == cfg.authority, MoltFlipError::Unauthorized);

        let m = &mut ctx.accounts.match_account;
        require!(m.status == MatchStatus::Locked, MoltFlipError::MatchNotLocked);
        require!(winner == m.creator || winner == m.joiner, MoltFlipError::InvalidWinner);

        // transfer 2*stake from vault to winner ATA
        let amount = m.stake.checked_mul(2).ok_or(MoltFlipError::MathOverflow)?;

        let seeds: &[&[u8]] = &[
            b"match",
            m.creator.as_ref(),
            &m.bump.to_le_bytes(),
        ];
        // NOTE: placeholder seeds; finalize seeds scheme during implementation.

        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_ata.to_account_info(),
            to: ctx.accounts.winner_ata.to_account_info(),
            authority: ctx.accounts.match_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        m.status = MatchStatus::Settled;
        Ok(())
    }
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
}

#[account]
pub struct MatchAccount {
    pub config: Pubkey,
    pub creator: Pubkey,
    pub joiner: Pubkey,
    pub stake: u64,
    pub status: MatchStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum MatchStatus {
    Open,
    Locked,
    Settled,
    Canceled,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 1,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateMatch<'info> {
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        // TODO: finalize deterministic seeds (e.g. include a match nonce)
        seeds = [b"match", creator.key().as_ref()],
        bump,
        space = 8 + 32 + 32 + 32 + 8 + 1 + 1
    )]
    pub match_account: Account<'info, MatchAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = creator
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = match_account
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinMatch<'info> {
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,

    #[account(mut)]
    pub joiner: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = joiner
    )]
    pub joiner_ata: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = match_account
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub match_account: Account<'info, MatchAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = match_account
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        // winner ATA must be passed in from client for winner pubkey
        associated_token::authority = winner
    )]
    pub winner_ata: Account<'info, TokenAccount>,

    /// CHECK: winner pubkey for ATA derivation
    pub winner: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum MoltFlipError {
    #[msg("Invalid stake")]
    InvalidStake,
    #[msg("Match is not open")]
    MatchNotOpen,
    #[msg("Match already joined")]
    AlreadyJoined,
    #[msg("Creator cannot join their own match")]
    CreatorCannotJoin,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Match not locked")]
    MatchNotLocked,
    #[msg("Invalid winner")]
    InvalidWinner,
    #[msg("Math overflow")]
    MathOverflow,
}
